/**
 * PACHECO SOLUTIONS — Transferências entre contas bancárias (fase 2)
 *
 * Move dinheiro entre duas contas da MESMA empresa. Não afeta o resultado
 * (receita/despesa) nem o saldo total: apenas debita a origem e credita o
 * destino — o saldo de cada conta é derivado em bankAccount.service.ts.
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { CompanyRequest } from '../middleware/company.middleware.ts';
import { canEdit } from '../middleware/company.middleware.ts';
import { isIsoDate, textOrNull, toCents } from '../utils/finance.ts';

const TRANSFER_SELECT = `SELECT bt.*,
  fa.alias AS from_alias, ta.alias AS to_alias
  FROM bank_transfers bt
  JOIN bank_accounts fa ON fa.id = bt.from_account_id
  JOIN bank_accounts ta ON ta.id = bt.to_account_id`;

export const listTransfers = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const q = (req.query ?? {}) as Record<string, unknown>;
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

    const clauses = ['bt.company_id = $1'];
    const params: (string | number)[] = [req.company!.id];
    if (start) {
      params.push(start);
      clauses.push(`bt.transfer_date >= $${params.length}`);
    }
    if (end) {
      params.push(end);
      clauses.push(`bt.transfer_date <= $${params.length}`);
    }

    const result = query(
      `${TRANSFER_SELECT}
        WHERE ${clauses.join(' AND ')}
        ORDER BY bt.transfer_date DESC, bt.created_at DESC
        LIMIT 200`,
      params,
    );
    res.json({ transfers: result.rows });
  } catch (error) {
    console.error('Erro ao listar transferências:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const createTransfer = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const body = req.body ?? {};
    const fromId = textOrNull(body.from_account_id);
    const toId = textOrNull(body.to_account_id);
    const amountCents = toCents(body.amount);
    const date = textOrNull(body.transfer_date) ?? new Date().toISOString().slice(0, 10);
    const description = textOrNull(body.description);

    if (!fromId || !toId) {
      res.status(400).json({
        error: 'from_account_id e to_account_id são obrigatórios.',
      });
      return;
    }
    if (fromId === toId) {
      res.status(400).json({ error: 'As contas de origem e destino devem ser diferentes.' });
      return;
    }
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({ error: 'Informe um valor de transferência maior que zero.' });
      return;
    }
    if (!isIsoDate(date)) {
      res.status(400).json({ error: 'transfer_date deve ser AAAA-MM-DD.' });
      return;
    }

    const accounts = query(
      `SELECT id, alias, active FROM bank_accounts
        WHERE id IN ($1, $2) AND company_id = $3`,
      [fromId, toId, req.company!.id],
    );
    if (accounts.rows.length !== 2) {
      res.status(422).json({
        error: 'Conta de origem ou destino inexistente nesta empresa.',
      });
      return;
    }
    if (accounts.rows.some((a) => Number(a.active) !== 1)) {
      res.status(422).json({ error: 'As contas da transferência precisam estar ativas.' });
      return;
    }

    const created = query(
      `INSERT INTO bank_transfers
         (company_id, from_account_id, to_account_id, amount, transfer_date,
          description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        req.company!.id,
        fromId,
        toId,
        amountCents,
        date,
        description,
        req.user!.id,
      ],
    );

    const full = query(`${TRANSFER_SELECT} WHERE bt.id = $1`, [
      String(created.rows[0].id),
    ]);

    res.status(201).json({
      message: 'Transferência registrada com sucesso!',
      transfer: full.rows[0],
    });
  } catch (error) {
    console.error('Erro ao criar transferência:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const deleteTransfer = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const deleted = query(
      `DELETE FROM bank_transfers WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company!.id],
    );
    if (deleted.rowCount === 0) {
      res.status(404).json({ error: 'Transferência não encontrada.' });
      return;
    }
    res.json({ message: 'Transferência excluída com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir transferência:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
