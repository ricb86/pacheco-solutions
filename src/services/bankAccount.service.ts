/**
 * PACHECO SOLUTIONS — Serviço de contas bancárias (módulo financeiro EXTAT)
 *
 * Cada empresa pode ter múltiplas contas (banco, agência, conta, tipo,
 * apelido e saldo de abertura imutável). O saldo ATUAL é derivado:
 *   saldo de abertura + pagamentos recebidos (receitas)
 *                      − pagamentos realizados (despesas)
 * contando também as linhas de estorno (livro-caixa).
 * Contas com movimentações não podem ser excluídas (integridade histórica).
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { CompanyRequest } from '../middleware/company.middleware.ts';
import { canEdit } from '../middleware/company.middleware.ts';
import { textOrNull, toCents } from '../utils/finance.ts';

const BANK_SELECT = `SELECT b.id, b.code, b.label, b.active FROM banks b`;

const ACCOUNT_SELECT = `SELECT a.*, b.code AS bank_code, b.label AS bank_label,
  (a.opening_balance + COALESCE((
      SELECT SUM(CASE WHEN ft.type = 'receita' THEN p.amount ELSE -p.amount END)
        FROM transaction_payments p
        JOIN financial_transactions ft ON ft.id = p.transaction_id
       WHERE p.bank_account_id = a.id
   ), 0)) AS current_balance,
  (SELECT COUNT(*) FROM financial_transactions ft
    WHERE ft.bank_account_id = a.id) AS transactions_count
  FROM bank_accounts a
  JOIN banks b ON b.id = a.bank_id`;

/* ── Catálogo de bancos ─────────────────────────────────── */

export const listBanks = async (
  _req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${BANK_SELECT} WHERE b.active = 1 ORDER BY b.label ASC`,
    );
    res.json({ banks: result.rows });
  } catch (error) {
    console.error('Erro ao listar bancos:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const createBank = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const code = textOrNull(req.body?.code);
    const label = textOrNull(req.body?.label);
    if (!code || !label) {
      res.status(400).json({ error: 'code e label são obrigatórios.' });
      return;
    }
    const created = query(
      `INSERT INTO banks (code, label) VALUES ($1, $2) RETURNING *`,
      [code, label],
    );
    res.status(201).json({ bank: created.rows[0] });
  } catch (error: unknown) {
    if (
      error instanceof Error && error.message.includes('UNIQUE')
    ) {
      res.status(409).json({ error: 'Já existe um banco com este código.' });
      return;
    }
    console.error('Erro ao criar banco:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/* ── Contas bancárias ───────────────────────────────────── */

export const listBankAccounts = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${ACCOUNT_SELECT}
       WHERE a.company_id = $1
       ORDER BY a.created_at ASC`,
      [req.company!.id],
    );
    res.json({ bank_accounts: result.rows });
  } catch (error) {
    console.error('Erro ao listar contas bancárias:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const createBankAccount = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const body = req.body ?? {};
    const bankId = textOrNull(body.bank_id);
    const alias = textOrNull(body.alias);
    const agency = textOrNull(body.agency);
    const accountNumber = textOrNull(body.account_number);
    const type = textOrNull(body.type);
    const openingCents = toCents(body.opening_balance ?? 0);

    if (!bankId || !alias || !agency || !accountNumber || !type) {
      res.status(400).json({
        error:
          'bank_id, alias, agency, account_number e type são obrigatórios.',
      });
      return;
    }
    if (!['corrente', 'poupanca', 'investimento'].includes(type)) {
      res.status(400).json({
        error: "type deve ser 'corrente', 'poupanca' ou 'investimento'.",
      });
      return;
    }
    if (!Number.isFinite(openingCents)) {
      res.status(400).json({ error: 'Saldo de abertura inválido.' });
      return;
    }

    // Banco precisa existir (catálogo global)
    const bank = query(`SELECT id FROM banks WHERE id = $1`, [bankId]);
    if (!bank.rows.length) {
      res.status(422).json({ error: 'Banco inexistente.' });
      return;
    }

    const created = query(
      `INSERT INTO bank_accounts
         (company_id, bank_id, alias, agency, account_number, type,
          opening_balance, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.company!.id,
        bankId,
        alias,
        agency,
        accountNumber,
        type,
        openingCents,
        req.user!.id,
      ],
    );

    const full = query(`${ACCOUNT_SELECT} WHERE a.id = $1`, [
      String(created.rows[0].id),
    ]);

    res.status(201).json({
      message: 'Conta bancária criada com sucesso!',
      bank_account: full.rows[0],
    });
  } catch (error) {
    console.error('Erro ao criar conta bancária:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const getBankAccount = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${ACCOUNT_SELECT} WHERE a.id = $1 AND a.company_id = $2`,
      [req.params.id, req.company!.id],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'Conta bancária não encontrada.' });
      return;
    }
    res.json({ bank_account: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar conta bancária:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const updateBankAccount = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const body = req.body ?? {};
    const updated = query(
      `UPDATE bank_accounts SET
         alias = COALESCE($1, alias),
         agency = COALESCE($2, agency),
         account_number = COALESCE($3, account_number),
         type = COALESCE($4, type),
         active = COALESCE($5, active),
         updated_at = datetime('now')
       WHERE id = $6 AND company_id = $7
       RETURNING *`,
      [
        textOrNull(body.alias),
        textOrNull(body.agency),
        textOrNull(body.account_number),
        textOrNull(body.type),
        typeof body.active === 'boolean' ? Number(body.active) : null,
        req.params.id,
        req.company!.id,
      ],
    );
    if (!updated.rows.length) {
      res.status(404).json({ error: 'Conta bancária não encontrada.' });
      return;
    }

    const full = query(`${ACCOUNT_SELECT} WHERE a.id = $1`, [req.params.id]);
    res.json({
      message: 'Conta bancária atualizada com sucesso!',
      bank_account: full.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar conta bancária:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const deleteBankAccount = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const found = query(
      `SELECT a.id,
        (SELECT COUNT(*) FROM financial_transactions ft
          WHERE ft.bank_account_id = a.id) AS used_by_transactions,
        (SELECT COUNT(*) FROM transaction_payments p
          WHERE p.bank_account_id = a.id) AS used_by_payments
       FROM bank_accounts a
      WHERE a.id = $1 AND a.company_id = $2`,
      [req.params.id, req.company!.id],
    );
    if (!found.rows.length) {
      res.status(404).json({ error: 'Conta bancária não encontrada.' });
      return;
    }

    const row = found.rows[0] as unknown as {
      used_by_transactions: number;
      used_by_payments: number;
    };
    if (Number(row.used_by_transactions) > 0 ||
      Number(row.used_by_payments) > 0
    ) {
      res.status(409).json({
        error:
          'Esta conta possui movimentações associadas e não pode ser excluída (integridade histórica). Desative-a se quiser tirá-la de uso.',
      });
      return;
    }

    query(
      `DELETE FROM bank_accounts WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company!.id],
    );
    res.json({ message: 'Conta bancária excluída com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir conta bancária:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
