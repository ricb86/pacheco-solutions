/**
 * ExtAT Platform — Entry point
 *
 * Correções em relação ao original:
 *   - imports de módulos inexistentes removidos (module-alias, helmet,
 *     compression, express-rate-limit, dotenv — nenhum estava instalado)
 *   - substituídos por equivalentes internos (src/middleware/security.ts,
 *     src/middleware/rateLimit.ts) e por carregamento de .env em
 *     src/config/env.ts
 *   - caminhos @config/@routes/@utils → imports relativos
 *   - health check e tratamento de erros mantidos
 */

import express from 'express';
import { config } from './config/env.ts';
import { connectDatabase } from './config/database.ts';
import { logger } from './utils/logger.ts';
import routes from './routes/index.ts';
import {
  securityHeaders,
  corsMiddleware,
} from './middleware/security.ts';
import { createRateLimiter } from './middleware/rateLimit.ts';
import { notFound, errorHandler } from './middleware/errorHandler.ts';

const app = express();

app.disable('x-powered-by');
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(express.json({ limit: '100kb' }));

// Rate limit global (janela de 1h em dev, 15min em produção)
const globalLimiter = createRateLimiter({
  windowMs: config.isProduction ? 15 * 60 * 1000 : 60 * 60 * 1000,
  max: config.isProduction ? 100 : 1000,
  message: 'Muitas requisições deste IP. Tente novamente mais tarde.',
});
app.use(globalLimiter);

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
  });
});

// Página inicial — visão geral da API
app.get('/', (_req, res) => {
  res.status(200).json({
    name: 'ExtAT Platform',
    version: '1.0.0',
    docs: {
      health: 'GET /health',
      register: 'POST /auth/register',
      login: 'POST /auth/login',
      meu_perfil: 'GET /users/profile',
      atualizar_perfil: 'PATCH /users/profile',
      usuario_por_id: 'GET /users/:id',
      listar_usuarios: 'GET /users (admin)',
      transacoes: 'GET /transactions',
      nova_transferencia: 'POST /transactions/create',
    },
  });
});

// Rotas da API
app.use(routes);

// 404 + handler de erros (devem vir por último)
app.use(notFound);
app.use(errorHandler);

async function start() {
  await connectDatabase();

  app.listen(config.port, () => {
    logger.info('═════════════════════════════════════════════════');
    logger.info('        EXTAT PLATFORM — SERVIDOR ATIVO           ');
    logger.info('═════════════════════════════════════════════════');
    logger.info(`🚀 URL principal:    http://localhost:${config.port}`);
    logger.info(`📊 Health check:     http://localhost:${config.port}/health`);
    logger.info(`🔐 Login:            http://localhost:${config.port}/auth/login`);
    logger.info(`💰 Transações:       http://localhost:${config.port}/transactions`);
    logger.info(`   Ambiente: ${process.env.NODE_ENV || 'development'}`);
    logger.info('═════════════════════════════════════════════════');
  });
}

start();
