/**
 * PACHECO SOLUTIONS — Middleware de contexto de empresa
 *
 * Módulo financeiro (escopo EXTAT): todas as rotas de finanças operam
 * DENTRO de uma empresa, informada no header `x-company-id` (mesmo
 * contrato da plataforma EXTAT). O middleware valida que:
 *   - o header foi enviado
 *   - a empresa existe e está ativa
 *   - o usuário autenticado é membro dela
 * e anexa `req.company = { id, name, document, role }`.
 */

import type { NextFunction, Request, Response } from 'express';
import { query } from '../config/database.ts';
import type { AuthRequest } from './auth.middleware.ts';

export interface CompanyContext {
  id: string;
  name: string;
  document: string;
  role: string;
}

export interface CompanyRequest extends AuthRequest {
  company?: CompanyContext;
}

export function companyMiddleware(
  req: CompanyRequest,
  res: Response,
  next: NextFunction,
) {
  const header = req.headers['x-company-id'];
  const companyId = Array.isArray(header) ? header[0] : header;

  if (!companyId) {
    return res.status(400).json({
      error: 'Header x-company-id é obrigatório para as rotas financeiras.',
    });
  }

  const result = query<Record<string, unknown>>(
    `SELECT c.id, c.name, c.document, c.active, m.role
       FROM companies c
       JOIN company_members m ON m.company_id = c.id
      WHERE c.id = $1 AND m.user_id = $2`,
    [companyId, req.user!.id],
  );

  const row = result.rows[0];
  if (!row) {
    return res.status(404).json({
      error: 'Empresa não encontrada ou você não é membro dela.',
    });
  }
  if (Number(row.active) !== 1) {
    return res.status(403).json({ error: 'Empresa inativa.' });
  }

  req.company = {
    id: String(row.id),
    name: String(row.name),
    document: String(row.document),
    role: String(row.role),
  };
  next();
}

/** Papéis que podem editar dados financeiros da empresa. */
export function canEdit(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'member';
}
