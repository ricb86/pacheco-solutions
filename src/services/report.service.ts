/**
 * PACHECO SOLUTIONS — Relatórios financeiros (fase 2)
 *
 * · Painel: saldo em contas, pendências, resultado do mês, tendência de
 *   6 meses e principais categorias de despesa.
 * · DRE: receitas e despesas por conta contábil no regime de COMPETÊNCIA.
 * · Fluxo de caixa: entradas/saídas realizadas (regime de CAIXA) com
 *   saldo inicial e saldo acumulado mês a mês.
 *
 * Todas as respostas expõem valores em REAIS (o adaptador do banco
 * converte apenas colunas conhecidas; aqui a conversão é explícita).
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { CompanyRequest } from '../middleware/company.middleware.ts';
import { ACCOUNT_SELECT } from './bankAccount.service.ts';
import { centsToReal, isIsoMonth, STATUS_SQL, textOrNull } from '../utils/finance.ts';

/* ── Helpers de mês ─────────────────────────────────────── */

function localMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function lastDayOfMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const day = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

function monthsBetween(start: string, end: string): string[] {
  const months: string[] = [];
  let cursor = start;
  while (cursor <= end && months.length < 36) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}

function badPeriod(res: Response, start: unknown, end: unknown): boolean {
  const s = textOrNull(start);
  const e = textOrNull(end);
  if (s && !isIsoMonth(s)) {
    res.status(400).json({ error: 'start_month deve ser AAAA-MM.' });
    return true;
  }
  if (e && !isIsoMonth(e)) {
    res.status(400).json({ error: 'end_month deve ser AAAA-MM.' });
    return true;
  }
  if (s && e && s > e) {
    res.status(400).json({ error: 'start_month não pode ser posterior a end_month.' });
    return true;
  }
  if (s && e && monthsBetween(s, e).length >= 36) {
    res.status(400).json({ error: 'Período máximo de 36 meses.' });
    return true;
  }
  return false;
}

/* ── Consultas comuns ───────────────────────────────────── */

interface Summary {
  total: number;
  count: number;
  paid: number;
  paid_count: number;
  overdue: number;
  overdue_count: number;
  due_today: number;
  due_today_count: number;
  upcoming: number;
  upcoming_count: number;
  partial: number;
  partial_count: number;
}

function statusSummary(companyId: string, type: 'receita' | 'despesa'): Summary {
  const result = query(
    `SELECT ${STATUS_SQL} AS status, COUNT(*) AS n,
            COALESCE(SUM(t.amount), 0) AS total_cents,
            COALESCE(SUM((
              SELECT COALESCE(SUM(p.amount), 0) FROM transaction_payments p
               WHERE p.transaction_id = t.id
            )), 0) AS paid_cents
       FROM financial_transactions t
      WHERE t.company_id = $1 AND t.type = $2
      GROUP BY status`,
    [companyId, type],
  );

  const summary: Summary = {
    total: 0,
    count: 0,
    paid: 0,
    paid_count: 0,
    overdue: 0,
    overdue_count: 0,
    due_today: 0,
    due_today_count: 0,
    upcoming: 0,
    upcoming_count: 0,
    partial: 0,
    partial_count: 0,
  };

  const keys: Record<string, [keyof Summary, keyof Summary]> = {
    pago: ['paid', 'paid_count'],
    vencido: ['overdue', 'overdue_count'],
    vence_hoje: ['due_today', 'due_today_count'],
    a_vencer: ['upcoming', 'upcoming_count'],
    pago_parcial: ['partial', 'partial_count'],
  };

  for (const row of result.rows) {
    const status = String(row.status);
    const count = Number(row.n);
    const total = centsToReal(row.total_cents);
    const paid = centsToReal(row.paid_cents);
    // Pendências mostram o valor AINDA EM ABERTO (total − pago).
    const value = status === 'pago' ? total : Math.max(0, total - paid);
    const key = keys[status];
    if (!key) continue;
    summary[key[0]] = value;
    summary[key[1]] = count;
  }

  // Total pendente = apenas o que falta pagar/receber.
  const pending: Array<[keyof Summary, keyof Summary]> = [
    ['overdue', 'overdue_count'],
    ['due_today', 'due_today_count'],
    ['upcoming', 'upcoming_count'],
    ['partial', 'partial_count'],
  ];
  for (const [valueKey, countKey] of pending) {
    summary.total += summary[valueKey] as number;
    summary.count += summary[countKey] as number;
  }

  return summary;
}

function monthlyFlow(
  companyId: string,
  start: string,
  end: string,
): Array<{ month: string; revenue: number; expense: number }> {
  const result = query(
    `SELECT substr(t.competence, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN t.type = 'receita' THEN t.amount ELSE 0 END), 0) AS revenue_cents,
            COALESCE(SUM(CASE WHEN t.type = 'despesa' THEN t.amount ELSE 0 END), 0) AS expense_cents
       FROM financial_transactions t
      WHERE t.company_id = $1
        AND substr(t.competence, 1, 7) BETWEEN $2 AND $3
      GROUP BY month
      ORDER BY month ASC`,
    [companyId, start, end],
  );

  const byMonth = new Map<string, { revenue: number; expense: number }>();
  for (const row of result.rows) {
    byMonth.set(String(row.month), {
      revenue: centsToReal(row.revenue_cents),
      expense: centsToReal(row.expense_cents),
    });
  }

  return monthsBetween(start, end).map((month) => ({
    month,
    revenue: byMonth.get(month)?.revenue ?? 0,
    expense: byMonth.get(month)?.expense ?? 0,
  }));
}

/* ── Painel ─────────────────────────────────────────────── */

export const getDashboard = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const companyId = req.company!.id;
    const month = localMonth();
    const start = addMonths(month, -5);

    const cash = query(
      `SELECT COALESCE(SUM(current_balance), 0) AS total_cents,
              COUNT(*) AS accounts
         FROM (${ACCOUNT_SELECT} WHERE a.company_id = $1)`,
      [companyId],
    ).rows[0];

    const monthRows = query(
      `SELECT t.type, COALESCE(SUM(t.amount), 0) AS total_cents
         FROM financial_transactions t
        WHERE t.company_id = $1 AND substr(t.competence, 1, 7) = $2
        GROUP BY t.type`,
      [companyId, month],
    ).rows;
    const monthRevenue = centsToReal(
      monthRows.find((r) => r.type === 'receita')?.total_cents ?? 0,
    );
    const monthExpense = centsToReal(
      monthRows.find((r) => r.type === 'despesa')?.total_cents ?? 0,
    );

    const categories = query(
      `SELECT COALESCE(c.code, '—') AS code,
              COALESCE(c.label, 'Sem categoria') AS label,
              COALESCE(SUM(t.amount), 0) AS total_cents
         FROM financial_transactions t
         LEFT JOIN chart_of_accounts c ON c.id = t.coa_id
        WHERE t.company_id = $1 AND t.type = 'despesa'
          AND substr(t.competence, 1, 7) = $2
        GROUP BY t.coa_id
        ORDER BY total_cents DESC
        LIMIT 6`,
      [companyId, month],
    ).rows;

    res.json({
      month,
      cash: {
        total_balance: centsToReal(cash?.total_cents ?? 0),
        accounts: Number(cash?.accounts ?? 0),
      },
      payables: statusSummary(companyId, 'despesa'),
      receivables: statusSummary(companyId, 'receita'),
      result: {
        revenue: monthRevenue,
        expense: monthExpense,
        net: monthRevenue - monthExpense,
      },
      trend: monthlyFlow(companyId, start, month),
      expense_categories: categories.map((c) => ({
        code: String(c.code),
        label: String(c.label),
        total: centsToReal(c.total_cents),
      })),
    });
  } catch (error) {
    console.error('Erro ao gerar painel:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── DRE (regime de competência) ────────────────────────── */

export const getDre = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const current = localMonth();
    const startMonth = textOrNull(q.start_month) ?? current;
    const endMonth = textOrNull(q.end_month) ?? startMonth;
    if (badPeriod(res, startMonth, endMonth)) return;

    const companyId = req.company!.id;
    const rows = query(
      `SELECT t.type,
              COALESCE(t.coa_id, 0) AS coa_id,
              COALESCE(c.code, '—') AS code,
              COALESCE(c.label, 'Sem categoria') AS label,
              COALESCE(SUM(t.amount), 0) AS total_cents,
              COUNT(*) AS count
         FROM financial_transactions t
         LEFT JOIN chart_of_accounts c ON c.id = t.coa_id
        WHERE t.company_id = $1
          AND substr(t.competence, 1, 7) BETWEEN $2 AND $3
        GROUP BY t.type, t.coa_id
        ORDER BY total_cents DESC`,
      [companyId, startMonth, endMonth],
    ).rows;

    const revenue = rows
      .filter((r) => r.type === 'receita')
      .map((r) => ({
        coa_id: Number(r.coa_id),
        code: String(r.code),
        label: String(r.label),
        total: centsToReal(r.total_cents),
        count: Number(r.count),
      }));
    const expense = rows
      .filter((r) => r.type === 'despesa')
      .map((r) => ({
        coa_id: Number(r.coa_id),
        code: String(r.code),
        label: String(r.label),
        total: centsToReal(r.total_cents),
        count: Number(r.count),
      }));

    const revenueTotal = revenue.reduce((sum, r) => sum + r.total, 0);
    const expenseTotal = expense.reduce((sum, r) => sum + r.total, 0);
    const net = revenueTotal - expenseTotal;

    res.json({
      period: {
        start_month: startMonth,
        end_month: endMonth,
        months: monthsBetween(startMonth, endMonth),
        start: `${startMonth}-01`,
        end: lastDayOfMonth(endMonth),
      },
      revenue,
      expense,
      revenue_total: revenueTotal,
      expense_total: expenseTotal,
      result: net,
      margin: revenueTotal > 0 ? Math.round((net / revenueTotal) * 10000) / 100 : null,
      by_month: monthlyFlow(companyId, startMonth, endMonth).map((m) => ({
        ...m,
        net: m.revenue - m.expense,
      })),
    });
  } catch (error) {
    console.error('Erro ao gerar DRE:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Fluxo de caixa (regime de caixa) ───────────────────── */

export const getCashFlow = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const current = localMonth();
    const startMonth = textOrNull(q.start_month) ?? addMonths(current, -5);
    const endMonth = textOrNull(q.end_month) ?? current;
    if (badPeriod(res, startMonth, endMonth)) return;

    const companyId = req.company!.id;
    const start = `${startMonth}-01`;
    const end = lastDayOfMonth(endMonth);

    const openingRow = query(
      `SELECT COALESCE(SUM(a.opening_balance), 0) AS opening_cents
         FROM bank_accounts a
        WHERE a.company_id = $1`,
      [companyId],
    ).rows[0];

    const beforeRow = query(
      `SELECT COALESCE(SUM(CASE WHEN ft.type = 'receita' THEN p.amount
                                ELSE -p.amount END), 0) AS net_cents
         FROM transaction_payments p
         JOIN financial_transactions ft ON ft.id = p.transaction_id
        WHERE p.company_id = $1 AND p.payment_date < $2`,
      [companyId, start],
    ).rows[0];

    const opening = centsToReal(openingRow?.opening_cents ?? 0) +
      centsToReal(beforeRow?.net_cents ?? 0);

    const flowRows = query(
      `SELECT substr(p.payment_date, 1, 7) AS month,
              COALESCE(SUM(CASE WHEN ft.type = 'receita' THEN p.amount ELSE 0 END), 0) AS inflow_cents,
              COALESCE(SUM(CASE WHEN ft.type = 'despesa' THEN p.amount ELSE 0 END), 0) AS outflow_cents
         FROM transaction_payments p
         JOIN financial_transactions ft ON ft.id = p.transaction_id
        WHERE p.company_id = $1
          AND p.payment_date >= $2 AND p.payment_date <= $3
        GROUP BY month
        ORDER BY month ASC`,
      [companyId, start, end],
    ).rows;

    const byMonth = new Map<string, { inflow: number; outflow: number }>();
    for (const row of flowRows) {
      byMonth.set(String(row.month), {
        inflow: centsToReal(row.inflow_cents),
        outflow: centsToReal(row.outflow_cents),
      });
    }

    let running = opening;
    const months = monthsBetween(startMonth, endMonth).map((month) => {
      const values = byMonth.get(month) ?? { inflow: 0, outflow: 0 };
      const net = values.inflow - values.outflow;
      running += net;
      return {
        month,
        inflow: values.inflow,
        outflow: values.outflow,
        net,
        closing: running,
      };
    });

    const inflowTotal = months.reduce((sum, m) => sum + m.inflow, 0);
    const outflowTotal = months.reduce((sum, m) => sum + m.outflow, 0);

    const accounts = query(
      `${ACCOUNT_SELECT} WHERE a.company_id = $1 ORDER BY a.created_at ASC`,
      [companyId],
    ).rows;

    res.json({
      period: {
        start_month: startMonth,
        end_month: endMonth,
        months: monthsBetween(startMonth, endMonth),
        start,
        end,
      },
      opening_balance: opening,
      inflow_total: inflowTotal,
      outflow_total: outflowTotal,
      net_total: inflowTotal - outflowTotal,
      closing_balance: running,
      months,
      accounts: accounts.map((a) => ({
        id: a.id,
        alias: a.alias,
        // current_balance já é convertido para reais pelo adaptador
        balance: Number(a.current_balance),
      })),
    });
  } catch (error) {
    console.error('Erro ao gerar fluxo de caixa:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
