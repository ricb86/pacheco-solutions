/**
 * PACHECO SOLUTIONS — Middleware de autenticação JWT
 *
 * Correções em relação ao original:
 *   - o original usava `jwt.verify(...) as AuthRequest.user`, sintaxe inválida
 *     de TypeScript (tipo de propriedade usado como tipo) — extraído para a
 *     interface UserPayload
 *   - mensagens de erro consistentes (401 para token ausente/inválido)
 */

import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.ts';

export interface UserPayload {
  id: string;
  username: string;
  role: string;
}

export interface AuthRequest extends Request {
  user?: UserPayload;
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (typeof decoded === 'string' || !decoded.id || !decoded.username) {
      return res.status(401).json({ error: 'Token inválido.' });
    }
    req.user = decoded as UserPayload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }
}

export function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.user?.role !== 'admin') {
    return res
      .status(403)
      .json({ error: 'Acesso de administrador necessário.' });
  }
  next();
}
