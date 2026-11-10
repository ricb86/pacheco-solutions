/**
 * ExtAT Platform — Middlewares de erro
 * (substitui o @middlewares/errorHandler que era importado mas não existia)
 */

import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.ts';

/** 404 para rotas inexistentes — responde JSON em vez de HTML. */
export function notFound(_req: Request, res: Response, _next: NextFunction) {
  res.status(404).json({ error: 'Rota não encontrada.' });
}

/** Handler de erros — deve ser o último middleware do app. */
export function errorHandler(
  err: Error & { statusCode?: number; expose?: boolean },
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const status = err.statusCode ?? 500;
  logger.error(
    `[${req.method}] ${req.originalUrl} — ${err.message}`,
  );

  res.status(status).json({
    error:
      status >= 500 && !err.expose
        ? 'Erro interno no servidor.'
        : err.message,
  });
}
