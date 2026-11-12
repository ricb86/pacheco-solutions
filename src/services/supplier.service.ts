/**
 * PACHECO SOLUTIONS — Serviço de fornecedores (módulo financeiro EXTAT)
 *
 * Cadastro simples por empresa: nome + documento (CNPJ/CPF) obrigatórios.
 * Fornecedores usados por movimentações não podem ser excluídos
 * (integridade histórica) — apenas desativados.
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { CompanyRequest } from '../middleware/company.middleware.ts';
import { canEdit } from '../middleware/company.middleware.ts';
import { textOrNull } from '../utils/finance.ts';

const SUPPLIER_SELECT = `SELECT s.*,
  (SELECT COUNT(*) FROM financial_transactions ft
    WHERE ft.supplier_id = s.id) AS usage_count
  FROM suppliers s`;

export const listSuppliers = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${SUPPLIER_SELECT}
       WHERE s.company_id = $1
       ORDER BY s.name COLLATE NOCASE ASC`,
      [req.company!.id],
    );
    res.json({ suppliers: result.rows });
  } catch (error) {
    console.error('Erro ao listar fornecedores:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const createSupplier = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const body = req.body ?? {};
    const name = textOrNull(body.name);
    const document = textOrNull(body.document);
    if (!name || !document) {
      res.status(400).json({ error: 'name e document são obrigatórios.' });
      return;
    }

    const created = query(
      `INSERT INTO suppliers (company_id, name, document, active, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        req.company!.id,
        name,
        document,
        body.active === false ? 0 : 1,
        req.user!.id,
      ],
    );
    res.status(201).json({
      message: 'Fornecedor criado com sucesso!',
      supplier: created.rows[0],
    });
  } catch (error) {
    console.error('Erro ao criar fornecedor:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const getSupplier = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${SUPPLIER_SELECT} WHERE s.id = $1 AND s.company_id = $2`,
      [req.params.id, req.company!.id],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'Fornecedor não encontrado.' });
      return;
    }
    res.json({ supplier: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar fornecedor:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const updateSupplier = async (
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
      `UPDATE suppliers SET
         name = COALESCE($1, name),
         document = COALESCE($2, document),
         active = COALESCE($3, active),
         updated_at = datetime('now')
       WHERE id = $4 AND company_id = $5
       RETURNING *`,
      [
        textOrNull(body.name),
        textOrNull(body.document),
        typeof body.active === 'boolean' ? Number(body.active) : null,
        req.params.id,
        req.company!.id,
      ],
    );
    if (!updated.rows.length) {
      res.status(404).json({ error: 'Fornecedor não encontrado.' });
      return;
    }
    res.json({
      message: 'Fornecedor atualizado com sucesso!',
      supplier: updated.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar fornecedor:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const deleteSupplier = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const found = query(
      `SELECT s.id,
        (SELECT COUNT(*) FROM financial_transactions ft
          WHERE ft.supplier_id = s.id) AS usage_count
       FROM suppliers s
      WHERE s.id = $1 AND s.company_id = $2`,
      [req.params.id, req.company!.id],
    );
    if (!found.rows.length) {
      res.status(404).json({ error: 'Fornecedor não encontrado.' });
      return;
    }
    if (Number((found.rows[0] as Record<string, unknown>).usage_count) > 0) {
      res.status(409).json({
        error:
          'Este fornecedor é usado por movimentações e não pode ser excluído. Desative-o se quiser tirá-lo de uso.',
      });
      return;
    }

    query(
      `DELETE FROM suppliers WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company!.id],
    );
    res.json({ message: 'Fornecedor excluído com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir fornecedor:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
