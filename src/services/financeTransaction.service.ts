/**
 * PACHECO SOLUTIONS — Serviço de movimentações financeiras (módulo EXTAT)
 *
 * Receitas e despesas com vencimento, pagamentos totais/parciais e
 * estorno no modelo livro-caixa (linha kind='reversal' com valor
 * NEGATIVO referenciando o pagamento original — mesmo design da EXTAT).
 *
 * Status é DERIVADO (não armazenado): pago > vencido > vence_hoje >
 * pago_parcial > a_vencer — ver STATUS_SQL em src/utils/finance.ts.
 *
 * Contrato EXTAT replicado:
 *   GET    /companies/transactions            (filtros paginados)
 *   POST   /companies/transactions            (criação; payment_date
 *          opcional registra pagamento integral)
 *   GET    /companies/transactions/:id        (detalhe + pagamentos)
 *   PATCH  /companies/transactions/:id         (TransactionChangesDTO)
 *   DELETE /companies/transactions/:id        ({confirm, reason})
 *   POST   /companies/transactions/:id/pay    (PaymentRequestDTO com
 *          idempotency_key ≤64 e janela de repetição de 10 s)
 *   POST   /companies/transactions/:id/payments/:paymentId/reverse
 *          ({reason} — estorna o restante daquele pagamento)
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { CompanyRequest } from '../middleware/company.middleware.ts';
import { canEdit } from '../middleware/company.middleware.ts';
import {
  PAYMENT_METHODS,
  STATUS_LABELS,
  STATUS_SQL,
  TRANSACTION_STATUSES,
  WhereBuilder,
  isIsoDate,
  isIsoMonth,
  parseListParam,
  textOrNull,
  toCents,
} from '../utils/finance.ts';

/* ── SQL base ───────────────────────────────────────────── */

const TX_SELECT = `SELECT t.id, t.type, t.amount, t.reference, t.more_infos,
  t.contact, t.url, t.tags, t.competence, t.due_date, t.origin,
  t.created_at, t.updated_at,
  ${STATUS_SQL} AS status,
  COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
             WHERE p.transaction_id = t.id), 0) AS paid_amount,
  (t.amount - COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                         WHERE p.transaction_id = t.id), 0)) AS remaining_amount,
  (SELECT MAX(p.payment_date) FROM transaction_payments p
    WHERE p.transaction_id = t.id AND p.kind = 'payment') AS payment_date,
  coa.id AS coa_id, coa.code AS coa_code, coa.label AS coa_label,
  coa.type AS coa_type,
  cc.id AS cost_center_id, cc.name AS cost_center_name,
  sup.id AS supplier_id, sup.name AS supplier_name,
  sup.document AS supplier_document,
  acc.id AS bank_account_id, acc.alias AS bank_account_alias,
  acc.agency AS bank_account_agency, acc.account_number AS bank_account_number,
  b.code AS bank_code, b.label AS bank_label,
  u.name AS created_by_name, u.username AS created_by_username
FROM financial_transactions t
LEFT JOIN chart_of_accounts coa ON coa.id = t.coa_id
LEFT JOIN cost_centers cc ON cc.id = t.cost_center_id
LEFT JOIN suppliers sup ON sup.id = t.supplier_id
LEFT JOIN bank_accounts acc ON acc.id = t.bank_account_id
LEFT JOIN banks b ON b.id = acc.bank_id
LEFT JOIN users u ON u.id = t.created_by`;

const PAYMENTS_SELECT = `SELECT p.id, p.amount, p.kind, p.reverses_payment_id,
  p.payment_date, p.payment_method, p.reason, p.created_at,
  acc.id AS bank_account_id, acc.alias AS bank_account_alias,
  acc.account_number AS bank_account_number,
  b.code AS bank_code, b.label AS bank_label,
  u.name AS created_by_name, u.username AS created_by_username,
  CASE WHEN p.kind = 'reversal' THEN 0
       ELSE p.amount + COALESCE((SELECT SUM(r.amount) FROM transaction_payments r
                                  WHERE r.reverses_payment_id = p.id), 0)
  END AS remaining_amount
FROM transaction_payments p
LEFT JOIN bank_accounts acc ON acc.id = p.bank_account_id
LEFT JOIN banks b ON b.id = acc.bank_id
LEFT JOIN users u ON u.id = p.created_by`;

/* ── Formatação das respostas (contrato EXTAT) ───────────── */

interface TxRow {
  [key: string]: unknown;
}

function shapeTransaction(row: TxRow) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    status_label: STATUS_LABELS[String(row.status)] ?? row.status,
    amount: row.amount,
    paid_amount: row.paid_amount,
    remaining_amount: row.remaining_amount,
    reference: row.reference,
    more_infos: row.more_infos,
    contact: row.contact,
    url: row.url,
    tags: parseTags(row.tags),
    competence: row.competence,
    due_date: row.due_date,
    payment_date: row.payment_date,
    origin: row.origin,
    category: row.coa_id
      ? {
        id: row.coa_id,
        code: row.coa_code,
        label: row.coa_label,
        type: row.coa_type,
      }
      : null,
    bank_account: row.bank_account_id
      ? {
        id: row.bank_account_id,
        alias: row.bank_account_alias,
        agency: row.bank_account_agency,
        account_number: row.bank_account_number,
        bank: { code: row.bank_code, label: row.bank_label },
      }
      : null,
    cost_center: row.cost_center_id
      ? { id: row.cost_center_id, name: row.cost_center_name }
      : null,
    supplier: row.supplier_id
      ? { id: row.supplier_id, name: row.supplier_name, document: row.supplier_document }
      : null,
    created_by: { name: row.created_by_name, username: row.created_by_username },
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function shapePayment(row: TxRow) {
  return {
    id: row.id,
    amount: row.amount,
    kind: row.kind,
    reverses_payment_id: row.reverses_payment_id,
    payment_date: row.payment_date,
    payment_method: row.payment_method,
    reason: row.reason,
    remaining_amount: row.remaining_amount,
    reversed: row.kind === 'payment' && Number(row.remaining_amount) === 0,
    bank_account: row.bank_account_id
      ? {
        id: row.bank_account_id,
        alias: row.bank_account_alias,
        account_number: row.bank_account_number,
        bank: { code: row.bank_code, label: row.bank_label },
      }
      : null,
    created_by: { name: row.created_by_name, username: row.created_by_username },
    created_at: row.created_at,
  };
}

function parseTags(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(String(raw));
    return Array.isArray(value) ? value.map(String) : [];
  } catch {
    return [];
  }
}

function serializeTags(tags: unknown): string | null {
  if (tags === undefined || tags === null) return null;
  if (Array.isArray(tags)) {
    return tags.length ? JSON.stringify(tags.map(String)) : null;
  }
  const s = String(tags).trim();
  if (!s) return null;
  try {
    JSON.parse(s);
    return s;
  } catch {
    const list = s.split(',').map((t) => t.trim()).filter(Boolean);
    return list.length ? JSON.stringify(list) : null;
  }
}

/* ── Leitura de saldo interno (centavos crus) ────────────── */

interface TxBalance {
  amount_cents: number;
  paid_cents: number;
  remaining_cents: number;
}

function loadTxBalance(
  txId: string,
  companyId: string,
): TxBalance | null {
  const result = query(
    `SELECT t.amount AS amount_cents,
            COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                       WHERE p.transaction_id = t.id), 0) AS paid_cents
       FROM financial_transactions t
      WHERE t.id = $1 AND t.company_id = $2`,
    [txId, companyId],
  );
  if (!result.rows.length) return null;
  const row = result.rows[0] as Record<string, number>;
  const amount_cents = Number(row.amount_cents);
  const paid_cents = Number(row.paid_cents);
  return {
    amount_cents,
    paid_cents,
    remaining_cents: amount_cents - paid_cents,
  };
}

/** Detalhe completo (transação + livro-caixa de pagamentos). */
function getTransactionDetail(txId: string, companyId: string) {
  const result = query(
    `${TX_SELECT}
      WHERE t.id = $1 AND t.company_id = $2`,
    [txId, companyId],
  );
  if (!result.rows.length) return null;
  const payments = query(
    `${PAYMENTS_SELECT}
      WHERE p.transaction_id = $1
      ORDER BY p.created_at ASC, p.id ASC`,
    [txId],
  );
  return {
    ...shapeTransaction(result.rows[0]),
    payments: payments.rows.map((p) => shapePayment(p as TxRow)),
  };
}

/* ── Validações de referências ──────────────────────────── */

function validateCoa(
  companyId: string,
  coaId: string,
  txType: string,
): string | null {
  const found = query(
    `SELECT coa.id, coa.type,
            (SELECT COUNT(*) FROM chart_of_accounts ch
              WHERE ch.parent_id = coa.id) AS children_count
       FROM chart_of_accounts coa
      WHERE coa.id = $1 AND coa.company_id = $2`,
    [coaId, companyId],
  );
  if (!found.rows.length) return 'Categoria não encontrada nesta empresa.';
  const row = found.rows[0] as Record<string, unknown>;
  if (String(row.type) !== txType) {
    return `A categoria deve ser do tipo "${txType}" para esta movimentação.`;
  }
  if (Number(row.children_count) > 0) {
    return 'Selecione uma conta analítica (sem subcontas).';
  }
  return null;
}

function validateBankAccount(
  companyId: string,
  accountId: string,
): string | null {
  const found = query(
    `SELECT id, active FROM bank_accounts WHERE id = $1 AND company_id = $2`,
    [accountId, companyId],
  );
  if (!found.rows.length) return 'Conta bancária não encontrada nesta empresa.';
  if (Number((found.rows[0] as Record<string, unknown>).active) !== 1) {
    return 'Conta bancária inativa.';
  }
  return null;
}

function refExists(table: string, companyId: string, id: string): boolean {
  const found = query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND company_id = $2`,
    [id, companyId],
  );
  return found.rows.length > 0;
}

function brl(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/* ── Listagem com filtros ────────────────────────────────── */

export const listTransactions = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const company = req.company!;
    const q = (req.query ?? {}) as Record<string, unknown>;

    const page = Math.max(1, parseInt(String(q.page ?? '1'), 10) || 1);
    const limit = Math.min(
      200,
      Math.max(1, parseInt(String(q.limit ?? '50'), 10) || 50),
    );

    const where = new WhereBuilder();
    where.add('t.company_id = $1', company.id);

    // type (extensão local: filtro da tela Transações da EXTAT)
    const type = textOrNull(q.type);
    if (type) {
      if (!['receita', 'despesa'].includes(type)) {
        res.status(400).json({ error: "type deve ser 'receita' ou 'despesa'." });
        return;
      }
      where.add(`t.type = $${where.values.length + 1}`, type);
    }

    // período (date_type: due_date | competence | payment_date)
    const dateType = textOrNull(q.date_type) ?? 'due_date';
    if (!['due_date', 'competence', 'payment_date'].includes(dateType)) {
      res.status(400).json({
        error: "date_type deve ser 'due_date', 'competence' ou 'payment_date'.",
      });
      return;
    }
    const start = textOrNull(q.start_date);
    const end = textOrNull(q.end_date);
    if (start && !isIsoDate(start)) {
      res.status(400).json({ error: 'start_date deve ser AAAA-MM-DD.' });
      return;
    }
    if (end && !isIsoDate(end)) {
      res.status(400).json({ error: 'end_date deve ser AAAA-MM-DD.' });
      return;
    }
    if (dateType === 'due_date') {
      if (start) where.add(`t.due_date >= $${where.values.length + 1}`, start);
      if (end) where.add(`t.due_date <= $${where.values.length + 1}`, end);
    } else if (dateType === 'competence') {
      // o filtro cobre os meses INTEIROS do intervalo
      if (start) {
        where.add(
          `substr(t.competence, 1, 7) >= substr($${where.values.length + 1}, 1, 7)`,
          start,
        );
      }
      if (end) {
        where.add(
          `substr(t.competence, 1, 7) <= substr($${where.values.length + 1}, 1, 7)`,
          end,
        );
      }
    } else {
      if (start || end) {
        const sub = `(SELECT MAX(p.payment_date) FROM transaction_payments p
                       WHERE p.transaction_id = t.id AND p.kind = 'payment')`;
        if (start) where.add(`${sub} >= $${where.values.length + 1}`, start);
        if (end) where.add(`${sub} <= $${where.values.length + 1}`, end);
      }
    }

    // status (derivado)
    const statuses = parseListParam(q.status);
    if (statuses.length) {
      const invalid = statuses.filter(
        (s) => !TRANSACTION_STATUSES.includes(s as (typeof TRANSACTION_STATUSES)[number]),
      );
      if (invalid.length) {
        res.status(400).json({
          error: `status inválido: ${invalid.join(', ')}. Use: ${TRANSACTION_STATUSES.join(', ')}.`,
        });
        return;
      }
      const placeholders = statuses.map(
        (_, i) => `$${where.values.length + i + 1}`,
      );
      where.add(
        `(${STATUS_SQL}) IN (${placeholders.join(', ')})`,
        ...statuses,
      );
    }

    // referências (listas separadas por vírgula)
    const categories = parseListParam(q.categories);
    if (categories.length) where.addIn('t.coa_id', categories);

    const costCenters = parseListParam(q.cost_centers);
    if (costCenters.length) where.addIn('t.cost_center_id', costCenters);

    const suppliers = parseListParam(q.suppliers);
    if (suppliers.length) where.addIn('t.supplier_id', suppliers);

    const bankAccounts = parseListParam(q.bank_accounts);
    if (bankAccounts.length) where.addIn('t.bank_account_id', bankAccounts);

    // busca textual (extensão local: campo de busca da tela EXTAT)
    const search = textOrNull(q.search);
    if (search) {
      const like = `%${search}%`;
      where.add(
        `(t.reference LIKE $${where.values.length + 1}
          OR t.more_infos LIKE $${where.values.length + 2}
          OR t.contact LIKE $${where.values.length + 3})`,
        like,
        like,
        like,
      );
    }

    const countResult = query(
      `SELECT COUNT(*) AS total_count FROM financial_transactions t ${where.sql}`,
      where.values,
    );
    const total = Number(
      (countResult.rows[0] as Record<string, unknown>).total_count,
    );

    const limitPh = `$${where.values.length + 1}`;
    const offsetPh = `$${where.values.length + 2}`;
    const rows = query(
      `${TX_SELECT} ${where.sql}
       ORDER BY (t.due_date IS NULL), t.due_date ASC, t.created_at DESC
       LIMIT ${limitPh} OFFSET ${offsetPh}`,
      [...where.values, limit, (page - 1) * limit],
    );

    res.json({
      transactions: rows.rows.map((r) => shapeTransaction(r as TxRow)),
      page,
      limit,
      total,
      total_pages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error('Erro ao listar movimentações:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Criação ─────────────────────────────────────────────── */

export const createTransaction = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const company = req.company!;
    const body = req.body ?? {};

    const type = textOrNull(body.type);
    if (!type || !['receita', 'despesa'].includes(type)) {
      res.status(400).json({ error: "type deve ser 'receita' ou 'despesa'." });
      return;
    }

    const amountCents = toCents(body.amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'amount deve ser um valor maior que zero.' });
      return;
    }

    const reference = textOrNull(body.reference);
    if (!reference) {
      res.status(400).json({ error: 'reference (descrição) é obrigatória.' });
      return;
    }

    const competence = textOrNull(body.competence);
    if (!competence || !isIsoMonth(competence)) {
      res.status(400).json({ error: 'competence é obrigatória (formato AAAA-MM).' });
      return;
    }

    const origin = textOrNull(body.origin) ?? 'bank_account';
    if (origin !== 'bank_account') {
      res.status(422).json({
        error:
          'Apenas a origem "bank_account" está disponível nesta fase. Cartões de crédito chegam em breve.',
      });
      return;
    }

    const bankAccountId = textOrNull(body.bank_account_id);
    if (!bankAccountId) {
      res.status(400).json({
        error: 'bank_account_id é obrigatório para origem em conta bancária.',
      });
      return;
    }
    const accountError = validateBankAccount(company.id, bankAccountId);
    if (accountError) {
      res.status(422).json({ error: accountError });
      return;
    }

    const dueDate = textOrNull(body.due_date);
    if (!dueDate || !isIsoDate(dueDate)) {
      res.status(400).json({
        error: 'due_date é obrigatória para origem em conta bancária (AAAA-MM-DD).',
      });
      return;
    }

    const coaId = textOrNull(body.coa_id);
    if (!coaId) {
      res.status(400).json({ error: 'coa_id (categoria) é obrigatório.' });
      return;
    }
    const coaError = validateCoa(company.id, coaId, type);
    if (coaError) {
      res.status(422).json({ error: coaError });
      return;
    }

    const costCenterId = textOrNull(body.cost_center_id);
    if (costCenterId && !refExists('cost_centers', company.id, costCenterId)) {
      res.status(422).json({ error: 'Centro de custo não encontrado nesta empresa.' });
      return;
    }

    const supplierId = textOrNull(body.supplier_id);
    if (supplierId && !refExists('suppliers', company.id, supplierId)) {
      res.status(422).json({ error: 'Fornecedor não encontrado nesta empresa.' });
      return;
    }

    // payment_date opcional → já nasce paga (pagamento integral na própria conta)
    let paymentDate: string | null = null;
    if (body.payment_date !== undefined && body.payment_date !== null) {
      const pd = textOrNull(body.payment_date);
      if (!pd || !isIsoDate(pd)) {
        res.status(400).json({ error: 'payment_date deve ser AAAA-MM-DD.' });
        return;
      }
      paymentDate = pd;
    }
    let paymentMethod: string = 'outros';
    if (paymentDate && body.payment_method !== undefined) {
      const pm = textOrNull(body.payment_method);
      if (!pm || !PAYMENT_METHODS.includes(pm as (typeof PAYMENT_METHODS)[number])) {
        res.status(400).json({ error: 'payment_method inválido.' });
        return;
      }
      paymentMethod = pm;
    }

    const created = query(
      `INSERT INTO financial_transactions
         (company_id, type, amount, reference, more_infos, contact, url,
          competence, due_date, origin, coa_id, bank_account_id,
          cost_center_id, supplier_id, tags, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'bank_account',
               $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        company.id,
        type,
        amountCents,
        reference,
        textOrNull(body.more_infos),
        textOrNull(body.contact),
        textOrNull(body.url),
        competence,
        dueDate,
        Number(coaId),
        bankAccountId,
        costCenterId,
        supplierId,
        serializeTags(body.tags),
        req.user!.id,
      ],
    );
    const txId = String((created.rows[0] as Record<string, unknown>).id);

    if (paymentDate) {
      query(
        `INSERT INTO transaction_payments
           (transaction_id, company_id, amount, kind, payment_date,
            payment_method, bank_account_id, idempotency_key, created_by)
         VALUES ($1, $2, $3, 'payment', $4, $5, $6, $7, $8)`,
        [
          txId,
          company.id,
          amountCents,
          paymentDate,
          paymentMethod,
          bankAccountId,
          `create:${txId}`,
          req.user!.id,
        ],
      );
    }

    res.status(201).json({
      message: paymentDate
        ? 'Movimentação criada e paga com sucesso!'
        : 'Movimentação criada com sucesso!',
      transaction: getTransactionDetail(txId, company.id),
    });
  } catch (error) {
    console.error('Erro ao criar movimentação:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Detalhe ─────────────────────────────────────────────── */

export const getTransaction = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const detail = getTransactionDetail(req.params.id, req.company!.id);
    if (!detail) {
      res.status(404).json({
        error: 'Movimentação não encontrada nesta empresa.',
      });
      return;
    }
    res.json({ transaction: detail });
  } catch (error) {
    console.error('Erro ao buscar movimentação:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Edição (TransactionChangesDTO) ──────────────────────── */

export const updateTransaction = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const company = req.company!;
    const txId = req.params.id;
    const balance = loadTxBalance(txId, company.id);
    if (!balance) {
      res.status(404).json({ error: 'Movimentação não encontrada nesta empresa.' });
      return;
    }

    const body = req.body ?? {};
    const current = query(
      `SELECT type FROM financial_transactions WHERE id = $1`,
      [txId],
    );
    const currentType = String(
      (current.rows[0] as Record<string, unknown>).type,
    );

    const typeProvided = textOrNull(body.type) !== null;
    const finalType = typeProvided ? String(body.type) : currentType;
    if (typeProvided && !['receita', 'despesa'].includes(finalType)) {
      res.status(400).json({ error: "type deve ser 'receita' ou 'despesa'." });
      return;
    }

    const amountProvided = body.amount !== undefined && body.amount !== null;
    let newAmountCents = balance.amount_cents;
    if (amountProvided) {
      newAmountCents = toCents(body.amount);
      if (!Number.isFinite(newAmountCents) || newAmountCents <= 0) {
        res.status(400).json({ error: 'amount deve ser maior que zero.' });
        return;
      }
      if (newAmountCents < balance.paid_cents) {
        res.status(422).json({
          error: `O novo valor não pode ser menor que o total já pago (${brl(balance.paid_cents)}).`,
        });
        return;
      }
    }

    const competence = textOrNull(body.competence);
    if (body.competence !== undefined && competence && !isIsoMonth(competence)) {
      res.status(400).json({ error: 'competence deve ter formato AAAA-MM.' });
      return;
    }
    const dueDate = textOrNull(body.due_date);
    if (body.due_date !== undefined && dueDate && !isIsoDate(dueDate)) {
      res.status(400).json({ error: 'due_date deve ter formato AAAA-MM-DD.' });
      return;
    }

    const coaId = textOrNull(body.coa_id);
    if (coaId) {
      const coaError = validateCoa(company.id, coaId, finalType);
      if (coaError) {
        res.status(422).json({ error: coaError });
        return;
      }
    }

    const bankProvided = body.bank_account_id !== undefined &&
      textOrNull(body.bank_account_id) !== null;
    if (bankProvided) {
      const accountError = validateBankAccount(
        company.id,
        String(body.bank_account_id),
      );
      if (accountError) {
        res.status(422).json({ error: accountError });
        return;
      }
    }

    const costCenterRaw = body.cost_center_id;
    const supplierRaw = body.supplier_id;
    if (typeof costCenterRaw === 'string' && costCenterRaw.trim() !== '' &&
      !refExists('cost_centers', company.id, costCenterRaw)
    ) {
      res.status(422).json({ error: 'Centro de custo não encontrado nesta empresa.' });
      return;
    }
    if (typeof supplierRaw === 'string' && supplierRaw.trim() !== '' &&
      !refExists('suppliers', company.id, supplierRaw)
    ) {
      res.status(422).json({ error: 'Fornecedor não encontrado nesta empresa.' });
      return;
    }

    // RN EXTAT: mudança de dinheiro em lançamento pago exige motivo
    const moneyChanged = amountProvided || typeProvided || bankProvided;
    const reason = textOrNull(body.reason);
    if (moneyChanged && balance.paid_cents > 0 && !reason) {
      res.status(400).json({
        error:
          'Esta movimentação já possui pagamentos: informe o campo "reason" (motivo da alteração financeira).',
      });
      return;
    }

    const costCenterParam = typeof costCenterRaw === 'string' &&
        costCenterRaw.trim() === ''
      ? '__clear__'
      : (costCenterRaw ?? null);
    const supplierParam = typeof supplierRaw === 'string' &&
        supplierRaw.trim() === ''
      ? '__clear__'
      : (supplierRaw ?? null);

    const updated = query(
      `UPDATE financial_transactions SET
         type = COALESCE($1, type),
         amount = COALESCE($2, amount),
         reference = COALESCE($3, reference),
         more_infos = COALESCE($4, more_infos),
         contact = COALESCE($5, contact),
         url = COALESCE($6, url),
         competence = COALESCE($7, competence),
         due_date = COALESCE($8, due_date),
         coa_id = COALESCE($9, coa_id),
         bank_account_id = COALESCE($10, bank_account_id),
         cost_center_id = CASE WHEN $11 = '__clear__' THEN NULL
                               ELSE COALESCE($11, cost_center_id) END,
         supplier_id = CASE WHEN $12 = '__clear__' THEN NULL
                             ELSE COALESCE($12, supplier_id) END,
         tags = COALESCE($13, tags),
         updated_at = datetime('now')
       WHERE id = $14 AND company_id = $15
       RETURNING id`,
      [
        typeProvided ? finalType : null,
        amountProvided ? newAmountCents : null,
        textOrNull(body.reference),
        textOrNull(body.more_infos),
        textOrNull(body.contact),
        textOrNull(body.url),
        competence,
        dueDate,
        coaId ? Number(coaId) : null,
        bankProvided ? String(body.bank_account_id) : null,
        costCenterParam,
        supplierParam,
        body.tags !== undefined ? serializeTags(body.tags) : null,
        txId,
        company.id,
      ],
    );
    if (!updated.rows.length) {
      res.status(404).json({ error: 'Movimentação não encontrada nesta empresa.' });
      return;
    }

    res.json({
      message: 'Movimentação atualizada com sucesso!',
      transaction: getTransactionDetail(txId, company.id),
    });
  } catch (error) {
    console.error('Erro ao atualizar movimentação:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Exclusão (confirmação explícita) ────────────────────── */

export const deleteTransaction = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    if (req.body?.confirm !== true) {
      res.status(400).json({
        error:
          'Confirmação explícita necessária: envie { "confirm": true } no corpo da requisição.',
      });
      return;
    }

    const deleted = query(
      `DELETE FROM financial_transactions
        WHERE id = $1 AND company_id = $2
       RETURNING id`,
      [req.params.id, req.company!.id],
    );
    if (!deleted.rows.length) {
      res.status(404).json({ error: 'Movimentação não encontrada nesta empresa.' });
      return;
    }

    res.json({
      message:
        'Movimentação excluída com sucesso! Pagamentos e estornos ligados a ela também foram removidos.',
    });
  } catch (error) {
    console.error('Erro ao excluir movimentação:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Pagamento (PaymentRequestDTO + idempotência) ────────── */

export const payTransaction = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const company = req.company!;
    const txId = req.params.id;
    const body = req.body ?? {};

    const tx = query(
      `SELECT t.origin FROM financial_transactions t
        WHERE t.id = $1 AND t.company_id = $2`,
      [txId, company.id],
    );
    if (!tx.rows.length) {
      res.status(404).json({ error: 'Movimentação não encontrada nesta empresa.' });
      return;
    }
    if (String((tx.rows[0] as Record<string, unknown>).origin) === 'credit_card') {
      res.status(422).json({
        error:
          'Compras no cartão de crédito não são pagas individualmente — quem se paga é a fatura.',
      });
      return;
    }

    const balance = loadTxBalance(txId, company.id)!;
    if (balance.remaining_cents <= 0) {
      res.status(422).json({ error: 'Esta movimentação já está totalmente paga.' });
      return;
    }

    const amountCents = toCents(body.amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'amount deve ser maior que zero.' });
      return;
    }
    if (amountCents > balance.remaining_cents) {
      res.status(422).json({
        error: `O valor excede o restante a pagar (${brl(balance.remaining_cents)}).`,
      });
      return;
    }

    const bankAccountId = textOrNull(body.bank_account_id);
    if (!bankAccountId) {
      res.status(400).json({ error: 'bank_account_id é obrigatório.' });
      return;
    }
    const accountError = validateBankAccount(company.id, bankAccountId);
    if (accountError) {
      res.status(422).json({ error: accountError });
      return;
    }

    const method = textOrNull(body.payment_method);
    if (!method || !PAYMENT_METHODS.includes(method as (typeof PAYMENT_METHODS)[number])) {
      res.status(400).json({
        error: `payment_method deve ser um de: ${PAYMENT_METHODS.join(', ')}.`,
      });
      return;
    }

    const paymentDate = textOrNull(body.payment_date);
    if (!paymentDate || !isIsoDate(paymentDate)) {
      res.status(400).json({ error: 'payment_date é obrigatória (AAAA-MM-DD).' });
      return;
    }

    // idempotência: chave informada (≤64) ou chave automática de 10 s
    let key = textOrNull(body.idempotency_key);
    if (key) {
      if (key.length > 64) {
        res.status(400).json({
          error: 'idempotency_key deve ter até 64 caracteres.',
        });
        return;
      }
    } else {
      const bucket = Math.floor(Date.now() / 10_000);
      key = `auto:${txId}:${amountCents}:${bankAccountId}:${paymentDate}:${method}:${req.user!.id}:${bucket}`;
    }

    const existing = query(
      `SELECT p.id, p.amount AS pay_cents, p.bank_account_id,
              p.payment_date, p.payment_method
         FROM transaction_payments p
        WHERE p.idempotency_key = $1`,
      [key],
    );
    if (existing.rows.length) {
      const row = existing.rows[0] as Record<string, unknown>;
      const samePayload = Math.round(Number(row.pay_cents)) === amountCents &&
        String(row.bank_account_id) === bankAccountId &&
        String(row.payment_date) === paymentDate &&
        String(row.payment_method) === method;
      if (samePayload) {
        res.status(200).json({
          message: 'Pagamento já registrado (pedido repetido detectado).',
          payment_id: row.id,
          replayed: true,
          transaction: getTransactionDetail(txId, company.id),
        });
        return;
      }
      res.status(409).json({
        error: 'idempotency_payload_mismatch',
        message:
          'Esta chave de idempotência já foi usada com um payload diferente.',
      });
      return;
    }

    try {
      const inserted = query(
        `INSERT INTO transaction_payments
           (transaction_id, company_id, amount, kind, payment_date,
            payment_method, bank_account_id, idempotency_key, created_by)
         VALUES ($1, $2, $3, 'payment', $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          txId,
          company.id,
          amountCents,
          paymentDate,
          method,
          bankAccountId,
          key,
          req.user!.id,
        ],
      );
      res.status(201).json({
        message: 'Pagamento registrado com sucesso!',
        payment_id: (inserted.rows[0] as Record<string, unknown>).id,
        replayed: false,
        transaction: getTransactionDetail(txId, company.id),
      });
    } catch (insertError) {
      // corrida: outra requisição inseriu a mesma chave agora
      if (insertError instanceof Error && insertError.message.includes('UNIQUE')) {
        const raced = query(
          `SELECT id FROM transaction_payments WHERE idempotency_key = $1`,
          [key],
        );
        if (raced.rows.length) {
          res.status(200).json({
            message: 'Pagamento já registrado (pedido repetido detectado).',
            payment_id: (raced.rows[0] as Record<string, unknown>).id,
            replayed: true,
            transaction: getTransactionDetail(txId, company.id),
          });
          return;
        }
      }
      throw insertError;
    }
  } catch (error) {
    console.error('Erro ao registrar pagamento:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Estorno de pagamento (livro-caixa) ──────────────────── */

export const reversePayment = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const company = req.company!;
    const { id: txId, paymentId } = req.params;
    const reason = textOrNull(req.body?.reason);
    if (!reason) {
      res.status(400).json({
        error: 'reason (motivo do estorno) é obrigatório.',
      });
      return;
    }

    const payment = query(
      `SELECT p.id, p.kind, p.bank_account_id, p.payment_method,
              (p.amount + COALESCE((SELECT SUM(r.amount) FROM transaction_payments r
                                     WHERE r.reverses_payment_id = p.id), 0)) AS pay_remaining_cents
         FROM transaction_payments p
        WHERE p.id = $1 AND p.transaction_id = $2 AND p.company_id = $3`,
      [paymentId, txId, company.id],
    );
    if (!payment.rows.length) {
      res.status(404).json({
        error: 'Pagamento não encontrado nesta movimentação.',
      });
      return;
    }
    const row = payment.rows[0] as Record<string, unknown>;
    if (String(row.kind) === 'reversal') {
      res.status(409).json({
        error: 'Esta linha é um estorno e não pode ser estornada novamente.',
      });
      return;
    }
    const remainingCents = Math.round(Number(row.pay_remaining_cents));
    if (remainingCents <= 0) {
      res.status(409).json({
        error: 'Este pagamento já foi estornado integralmente.',
      });
      return;
    }

    const inserted = query(
      `INSERT INTO transaction_payments
         (transaction_id, company_id, amount, kind, reverses_payment_id,
          payment_date, payment_method, bank_account_id, reason, created_by)
       VALUES ($1, $2, $3, 'reversal', $4, date('now'), $5, $6, $7, $8)
       RETURNING id`,
      [
        txId,
        company.id,
        -remainingCents,
        paymentId,
        String(row.payment_method),
        String(row.bank_account_id),
        reason,
        req.user!.id,
      ],
    );

    res.status(201).json({
      message: 'Estorno registrado com sucesso!',
      payment_id: (inserted.rows[0] as Record<string, unknown>).id,
      transaction: getTransactionDetail(txId, company.id),
    });
  } catch (error) {
    console.error('Erro ao estornar pagamento:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
