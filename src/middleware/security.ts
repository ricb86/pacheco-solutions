/**
 * PACHECO SOLUTIONS — Middlewares de segurança
 *
 * Substituem os pacotes helmet/cors do original (que não estavam instalados):
 *   - securityHeaders: cabeçalhos de segurança HTTP
 *   - corsMiddleware: CORS com lista de origens permitidas via .env
 */

import type { NextFunction, Request, Response } from 'express';
import { config } from '../config/env.ts';

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=()',
  );
  next();
}

export function corsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const origin = req.headers.origin;

  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization',
    );
  }

  // Pré-flight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}
