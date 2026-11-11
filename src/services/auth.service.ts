/**
 * PACHECO SOLUTIONS — Serviço de autenticação (registro e login)
 *
 * Correções em relação ao original:
 *   - importava getClient sem usar (e a função não existia no database.ts)
 *   - AuthRequest extends Request sem importar Request (erro de compilação)
 *   - validação de entrada (formato de username/e-mail/senha)
 *   - expiração do token agora vem do .env (AUTH_TOKEN_EXPIRATION)
 */

import type { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { query } from '../config/database.ts';
import { config } from '../config/env.ts';
import type { AuthRequest, UserPayload } from '../middleware/auth.middleware.ts';

interface UserRow {
  id: string;
  username: string;
  email: string;
  name: string;
  role: string;
  balance: number;
  password_hash: string;
}

function issueToken(user: UserPayload): string {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as SignOptions['expiresIn'] },
  );
}

export const registerController = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { username, email, password, name, cpf } = req.body ?? {};

    if (!username || !email || !password || !name) {
      res.status(400).json({
        error: 'Username, email, password e name são obrigatórios.',
      });
      return;
    }
    if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
      res.status(400).json({
        error:
          'Username deve ter 3-30 caracteres (letras, números, ponto, hífen ou underline).',
      });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Email inválido.' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({
        error: 'A senha deve ter pelo menos 6 caracteres.',
      });
      return;
    }

    const existingUser = await query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email, username],
    );
    if (existingUser.rows.length > 0) {
      res.status(400).json({ error: 'Usuário ou email já cadastrado.' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptSaltRounds);

    const result = await query(
      `INSERT INTO users (username, email, password_hash, name, cpf)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, name, role`,
      [username, email, passwordHash, name, cpf || null],
    );

    const user = result.rows[0] as unknown as UserPayload;
    res.status(201).json({
      message: 'Usuário criado com sucesso!',
      user,
      token: issueToken(user),
    });
  } catch (error) {
    console.error('Erro no register:', error);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
};

export const loginController = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const { email, password } = req.body ?? {};

    if (!email || !password) {
      res.status(400).json({ error: 'Email e senha são obrigatórios.' });
      return;
    }

    const result = await query(
      'SELECT id, username, email, name, role, balance, password_hash FROM users WHERE email = $1',
      [email],
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    const user = result.rows[0] as unknown as UserRow;
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      res.status(401).json({ error: 'Credenciais inválidas.' });
      return;
    }

    res.json({
      message: 'Login realizado com sucesso!',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
        balance: user.balance,
      },
      token: issueToken({
        id: user.id,
        username: user.username,
        role: user.role,
      }),
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login.' });
  }
};
