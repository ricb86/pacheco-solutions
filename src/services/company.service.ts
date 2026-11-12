/**
 * PACHECO SOLUTIONS — Serviço de empresas (módulo financeiro EXTAT)
 *
 * Multi-empresa: cada usuário pode criar/gerir várias empresas; acesso
 * aos dados financeiros é mediado por `company_members` (papel de cada
 * usuário na empresa — convites formais chegam na fase 3).
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { AuthRequest } from '../middleware/auth.middleware.ts';
import { textOrNull, toCents } from '../utils/finance.ts';

const COMPANY_SELECT = `SELECT c.*, m.role AS my_role,
  (SELECT COUNT(*) FROM company_members cm WHERE cm.company_id = c.id) AS members_count
  FROM companies c
  JOIN company_members m ON m.company_id = c.id AND m.user_id = $1`;

export const listCompanies = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${COMPANY_SELECT}
       WHERE c.active = 1
       ORDER BY c.created_at ASC`,
      [req.user!.id],
    );
    res.json({ companies: result.rows });
  } catch (error) {
    console.error('Erro ao listar empresas:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const createCompany = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const body = req.body ?? {};
    const name = textOrNull(body.name);
    const document = textOrNull(body.document);
    const business = textOrNull(body.business);

    if (!name || !document || !business) {
      res.status(400).json({
        error: 'name, document e business são obrigatórios.',
      });
      return;
    }

    // Endereço estruturado (opcional) — armazenado como JSON
    const address = body.address && typeof body.address === 'object'
      ? JSON.stringify(body.address)
      : textOrNull(body.address);
    const averageBillingCents = toCents(body.average_billing ?? 0);

    const created = query(
      `INSERT INTO companies
         (name, trade_name, document, business, email, phone, website,
          tax_regime, average_billing, founded_at, address, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        name,
        textOrNull(body.trade_name),
        document,
        business,
        textOrNull(body.email),
        textOrNull(body.phone),
        textOrNull(body.website),
        textOrNull(body.tax_regime),
        Number.isFinite(averageBillingCents) ? averageBillingCents : 0,
        textOrNull(body.founded_at),
        address,
        req.user!.id,
      ],
    );

    const company = created.rows[0];

    // Criador vira owner da empresa
    query(
      `INSERT INTO company_members (company_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [String(company.id), req.user!.id],
    );

    res.status(201).json({
      message: 'Empresa criada com sucesso!',
      company,
    });
  } catch (error) {
    console.error('Erro ao criar empresa:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const getCompany = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = query(
      `${COMPANY_SELECT} AND c.id = $2`,
      [req.user!.id, req.params.id],
    );
    const company = result.rows[0];
    if (!company) {
      res.status(404).json({
        error: 'Empresa não encontrada ou você não é membro dela.',
      });
      return;
    }
    res.json({ company });
  } catch (error) {
    console.error('Erro ao buscar empresa:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const updateCompany = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const member = query(
      `SELECT m.role FROM company_members m
        WHERE m.company_id = $1 AND m.user_id = $2`,
      [id, req.user!.id],
    );
    if (!member.rows.length) {
      res.status(404).json({ error: 'Empresa não encontrada.' });
      return;
    }
    const role = String(member.rows[0].role);
    if (role !== 'owner' && role !== 'admin') {
      res.status(403).json({
        error: 'Apenas o proprietário ou um admin da empresa pode editá-la.',
      });
      return;
    }

    const body = req.body ?? {};
    const address = body.address && typeof body.address === 'object'
      ? JSON.stringify(body.address)
      : textOrNull(body.address);
    const averageBillingCents = body.average_billing === undefined
      ? undefined
      : toCents(body.average_billing);

    const updated = query(
      `UPDATE companies SET
         name = COALESCE($1, name),
         trade_name = COALESCE($2, trade_name),
         document = COALESCE($3, document),
         business = COALESCE($4, business),
         email = COALESCE($5, email),
         phone = COALESCE($6, phone),
         website = COALESCE($7, website),
         tax_regime = COALESCE($8, tax_regime),
         average_billing = COALESCE($9, average_billing),
         founded_at = COALESCE($10, founded_at),
         address = COALESCE($11, address),
         updated_at = datetime('now')
       WHERE id = $12
       RETURNING *`,
      [
        textOrNull(body.name),
        textOrNull(body.trade_name),
        textOrNull(body.document),
        textOrNull(body.business),
        textOrNull(body.email),
        textOrNull(body.phone),
        textOrNull(body.website),
        textOrNull(body.tax_regime),
        averageBillingCents !== undefined && Number.isFinite(averageBillingCents)
          ? averageBillingCents
          : null,
        textOrNull(body.founded_at),
        address,
        id,
      ],
    );

    res.json({
      message: 'Empresa atualizada com sucesso!',
      company: updated.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar empresa:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const deleteCompany = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const member = query(
      `SELECT m.role FROM company_members m
        WHERE m.company_id = $1 AND m.user_id = $2`,
      [id, req.user!.id],
    );
    if (!member.rows.length) {
      res.status(404).json({ error: 'Empresa não encontrada.' });
      return;
    }
    if (String(member.rows[0].role) !== 'owner') {
      res.status(403).json({
        error: 'Apenas o proprietário pode excluir a empresa.',
      });
      return;
    }

    // Cascata: membros, contas, plano de contas, movimentações e pagamentos
    query(`DELETE FROM companies WHERE id = $1`, [id]);

    res.json({
      message:
        'Empresa excluída com todos os seus dados financeiros (contas, plano de contas, movimentações e pagamentos).',
    });
  } catch (error) {
    console.error('Erro ao excluir empresa:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/** Papel do usuário na empresa (null se não for membro). */
function getMembership(companyId: string, userId: string): string | null {
  const result = query(
    `SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2`,
    [companyId, userId],
  );
  return result.rows.length ? String(result.rows[0].role) : null;
}

/** Membros da empresa — visível a qualquer membro. */
export const listMembers = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const companyId = req.params.id;
    if (!getMembership(companyId, req.user!.id)) {
      res.status(404).json({ error: 'Empresa não encontrada.' });
      return;
    }
    const result = query(
      `SELECT m.user_id AS id, u.name, u.email, u.username, m.role, m.created_at
         FROM company_members m
         JOIN users u ON u.id = m.user_id
        WHERE m.company_id = $1
        ORDER BY m.created_at ASC`,
      [companyId],
    );
    res.json({ members: result.rows });
  } catch (error) {
    console.error('Erro ao listar membros:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer'];

/** Adiciona um usuário já cadastrado à empresa (convite por email). */
export const addMember = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const companyId = req.params.id;
    const myRole = getMembership(companyId, req.user!.id);
    if (!myRole) {
      res.status(404).json({ error: 'Empresa não encontrada.' });
      return;
    }
    if (myRole !== 'owner' && myRole !== 'admin') {
      res.status(403).json({
        error: 'Apenas o proprietário ou um admin pode adicionar membros.',
      });
      return;
    }

    const email = textOrNull(req.body?.email);
    const role = textOrNull(req.body?.role) ?? 'member';
    if (!email) {
      res.status(400).json({ error: 'Informe o email do usuário.' });
      return;
    }
    if (!ASSIGNABLE_ROLES.includes(role)) {
      res.status(400).json({
        error: `role deve ser: ${ASSIGNABLE_ROLES.join(', ')}.`,
      });
      return;
    }

    const user = query(
      `SELECT id, name, username, email FROM users WHERE lower(email) = lower($1)`,
      [email],
    ).rows[0];
    if (!user) {
      res.status(404).json({
        error:
          'Nenhuma conta encontrada com este email. Peça ao usuário para criar uma conta na plataforma primeiro.',
      });
      return;
    }

    if (getMembership(companyId, String(user.id))) {
      res.status(409).json({ error: 'Este usuário já é membro da empresa.' });
      return;
    }

    query(
      `INSERT INTO company_members (company_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [companyId, String(user.id), role],
    );

    res.status(201).json({
      message: `${user.name} foi adicionado(a) à empresa.`,
      member: {
        id: user.id,
        name: user.name,
        username: user.username,
        email: user.email,
        role,
      },
    });
  } catch (error) {
    console.error('Erro ao adicionar membro:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/** Altera o papel de um membro (apenas o proprietário). */
export const updateMemberRole = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const companyId = req.params.id;
    const myRole = getMembership(companyId, req.user!.id);
    if (!myRole) {
      res.status(404).json({ error: 'Empresa não encontrada.' });
      return;
    }
    if (myRole !== 'owner') {
      res.status(403).json({
        error: 'Apenas o proprietário pode alterar o papel dos membros.',
      });
      return;
    }

    const targetRole = getMembership(companyId, req.params.userId);
    if (!targetRole) {
      res.status(404).json({ error: 'Membro não encontrado.' });
      return;
    }
    if (targetRole === 'owner') {
      res.status(422).json({ error: 'O papel do proprietário não pode ser alterado.' });
      return;
    }

    const role = textOrNull(req.body?.role);
    if (!role || !ASSIGNABLE_ROLES.includes(role)) {
      res.status(400).json({
        error: `role deve ser: ${ASSIGNABLE_ROLES.join(', ')}.`,
      });
      return;
    }

    query(
      `UPDATE company_members SET role = $1
        WHERE company_id = $2 AND user_id = $3`,
      [role, companyId, req.params.userId],
    );

    res.json({
      message: 'Papel atualizado com sucesso!',
      member: { id: req.params.userId, role },
    });
  } catch (error) {
    console.error('Erro ao atualizar papel do membro:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

/** Remove um membro (o proprietário nunca pode ser removido). */
export const removeMember = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const companyId = req.params.id;
    const myRole = getMembership(companyId, req.user!.id);
    if (!myRole) {
      res.status(404).json({ error: 'Empresa não encontrada.' });
      return;
    }
    if (myRole !== 'owner' && myRole !== 'admin') {
      res.status(403).json({
        error: 'Apenas o proprietário ou um admin pode remover membros.',
      });
      return;
    }

    const targetRole = getMembership(companyId, req.params.userId);
    if (!targetRole) {
      res.status(404).json({ error: 'Membro não encontrado.' });
      return;
    }
    if (targetRole === 'owner') {
      res.status(422).json({ error: 'O proprietário não pode ser removido da empresa.' });
      return;
    }
    if (myRole === 'admin' && targetRole === 'admin') {
      res.status(403).json({
        error: 'Apenas o proprietário pode remover um admin.',
      });
      return;
    }

    query(
      `DELETE FROM company_members WHERE company_id = $1 AND user_id = $2`,
      [companyId, req.params.userId],
    );
    res.json({ message: 'Membro removido da empresa.' });
  } catch (error) {
    console.error('Erro ao remover membro:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
