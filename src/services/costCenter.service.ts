/**
 * PACHECO SOLUTIONS — Serviço de centros de custo (módulo financeiro EXTAT)
 *
 * Cadastro simples por empresa: nome único. Centros usados por
 * movimentações não podem ser excluídos (integridade histórica) —
 * apenas desativados.
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { CompanyRequest } from '../middleware/company.middleware.ts';
import { canEdit } from '../middleware/company.middleware.ts';
import { textOrNull } from '../utils/finance.ts';

const CENTER_SELECT = `SELECT cc.*,
  (SELECT COUNT(*) FROM financial_transactions ft
    WHERE ft.cost_center_id = cc.id) AS usage_count
  FROM cost_centers cc`;

export const listCostCenters = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${CENTER_SELECT}
       WHERE cc.company_id = $1
       ORDER BY cc.name COLLATE NOCASE ASC`,
      [req.company!.id],
    );
    res.json({ cost_centers: result.rows });
  } catch (error) {
    console.error('Erro ao listar centros de custo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const createCostCenter = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const name = textOrNull(req.body?.name);
    if (!name) {
      res.status(400).json({ error: 'name é obrigatório.' });
      return;
    }

    const duplicate = query(
      `SELECT 1 FROM cost_centers WHERE company_id = $1 AND name = $2`,
      [req.company!.id, name],
    );
    if (duplicate.rows.length) {
      res.status(409).json({
        error: 'Já existe um centro de custo com este nome nesta empresa.',
      });
      return;
    }

    const created = query(
      `INSERT INTO cost_centers (company_id, name, active, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        req.company!.id,
        name,
        req.body?.active === false ? 0 : 1,
        req.user!.id,
      ],
    );
    res.status(201).json({
      message: 'Centro de custo criado com sucesso!',
      cost_center: created.rows[0],
    });
  } catch (error) {
    console.error('Erro ao criar centro de custo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const getCostCenter = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${CENTER_SELECT} WHERE cc.id = $1 AND cc.company_id = $2`,
      [req.params.id, req.company!.id],
    );
    if (!result.rows.length) {
      res.status(404).json({ error: 'Centro de custo não encontrado.' });
      return;
    }
    res.json({ cost_center: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar centro de custo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const updateCostCenter = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const name = textOrNull(req.body?.name);
    if (name) {
      const duplicate = query(
        `SELECT 1 FROM cost_centers WHERE company_id = $1 AND name = $2 AND id != $3`,
        [req.company!.id, name, req.params.id],
      );
      if (duplicate.rows.length) {
        res.status(409).json({
          error: 'Já existe um centro de custo com este nome nesta empresa.',
        });
        return;
      }
    }

    const updated = query(
      `UPDATE cost_centers SET
         name = COALESCE($1, name),
         active = COALESCE($2, active),
         updated_at = datetime('now')
       WHERE id = $3 AND company_id = $4
       RETURNING *`,
      [
        name,
        typeof req.body?.active === 'boolean'
          ? Number(req.body.active)
          : null,
        req.params.id,
        req.company!.id,
      ],
    );
    if (!updated.rows.length) {
      res.status(404).json({ error: 'Centro de custo não encontrado.' });
      return;
    }
    res.json({
      message: 'Centro de custo atualizado com sucesso!',
      cost_center: updated.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar centro de custo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const deleteCostCenter = async (
  req: CompanyRequest,
  res: Response,
): Promise<void> => {
  try {
    if (!canEdit(req.company!.role)) {
      res.status(403).json({ error: 'Sem permissão para editar esta empresa.' });
      return;
    }

    const found = query(
      `SELECT cc.id,
        (SELECT COUNT(*) FROM financial_transactions ft
          WHERE ft.cost_center_id = cc.id) AS usage_count
       FROM cost_centers cc
      WHERE cc.id = $1 AND cc.company_id = $2`,
      [req.params.id, req.company!.id],
    );
    if (!found.rows.length) {
      res.status(404).json({ error: 'Centro de custo não encontrado.' });
      return;
    }
    if (Number((found.rows[0] as Record<string, unknown>).usage_count) > 0) {
      res.status(409).json({
        error:
          'Este centro de custo é usado por movimentações e não pode ser excluído. Desative-o se quiser tirá-lo de uso.',
      });
      return;
    }

    query(
      `DELETE FROM cost_centers WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.company!.id],
    );
    res.json({ message: 'Centro de custo excluído com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir centro de custo:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
