/**
 * PACHECO SOLUTIONS — Rotas de transações
 */

import { Router } from 'express';
import {
  createTransaction,
  getTransactions,
} from '../services/transaction.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

// Todas as rotas de transações exigem autenticação
router.use(authMiddleware);

router.get('/', getTransactions);
router.post(
  '/create',
  validateBody('receiver_username', 'amount'),
  createTransaction,
);

export default router;
