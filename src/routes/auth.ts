/**
 * ExtAT Platform — Rotas de autenticação
 */

import { Router } from 'express';
import { registerController, loginController } from '../services/auth.service.ts';
import { createRateLimiter } from '../middleware/rateLimit.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

// Proteção extra contra brute-force no login/registro
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100, // tentativas por IP
  message: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.',
});

router.post('/register', authLimiter, registerController);
router.post('/login', authLimiter, loginController);

export default router;
