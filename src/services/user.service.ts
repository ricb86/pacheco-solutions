/**
 * PACHECO SOLUTIONS — Serviço de usuários (perfil)
 */

import type { Response } from 'express';
import { query } from '../config/database.ts';
import type { AuthRequest } from '../middleware/auth.middleware.ts';

export const getUserProfile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    const result = await query(
      'SELECT id, username, email, name, cpf, balance, role, created_at FROM users WHERE id = $1',
      [id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ error: 'Erro ao buscar perfil do usuário.' });
  }
};

export const getMyProfile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await query(
      'SELECT id, username, email, name, cpf, balance, role, created_at FROM users WHERE id = $1',
      [req.user!.id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ error: 'Erro ao buscar perfil do usuário.' });
  }
};

export const updateUserProfile = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    // Só permite atualizar o próprio perfil
    const { name, cpf } = req.body ?? {};
    const id = req.user!.id;

    const result = await query(
      `UPDATE users
       SET name = COALESCE($1, name), cpf = COALESCE($2, cpf),
           updated_at = datetime('now')
       WHERE id = $3
       RETURNING id, username, email, name, cpf, balance, role`,
      [name ?? null, cpf ?? null, id],
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Usuário não encontrado.' });
      return;
    }

    res.json({
      message: 'Perfil atualizado com sucesso!',
      user: result.rows[0],
    });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Erro ao atualizar perfil do usuário.' });
  }
};

export const listUsers = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const result = await query(
      'SELECT id, username, email, name, role, balance, created_at FROM users ORDER BY created_at DESC',
    );
    res.json({ users: result.rows });
  } catch (error) {
    console.error('Erro ao listar usuários:', error);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
};
