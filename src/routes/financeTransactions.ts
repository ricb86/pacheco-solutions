/**
 * PACHECO SOLUTIONS — Rotas de movimentações financeiras (módulo EXTAT)
 *
 * Montado em /companies/transactions (contrato EXTAT). IMPORTANTE:
 * montado ANTES de /companies/:id no barrel.
 */

import { Router } from 'express';
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  listTransactions,
  payTransaction,
  reversePayment,
  updateTransaction,
} from '../services/financeTransaction.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { companyMiddleware } from '../middleware/company.middleware.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

router.use(authMiddleware, companyMiddleware);

router.get('/', listTransactions);
router.post(
  '/',
  validateBody('type', 'amount', 'reference', 'competence'),
  createTransaction,
);
router.get('/:id', getTransaction);
router.patch('/:id', updateTransaction);
router.delete('/:id', deleteTransaction);
router.post(
  '/:id/pay',
  validateBody('amount', 'bank_account_id', 'payment_date', 'payment_method'),
  payTransaction,
);
router.post(
  '/:id/payments/:paymentId/reverse',
  validateBody('reason'),
  reversePayment,
);

export default router;
