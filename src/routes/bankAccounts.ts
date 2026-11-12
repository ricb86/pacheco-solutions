/**
 * PACHECO SOLUTIONS — Rotas de contas bancárias (módulo financeiro EXTAT)
 *
 * Escopo por empresa via header `x-company-id`.
 */

import { Router } from 'express';
import {
  createBankAccount,
  deleteBankAccount,
  getBankAccount,
  listBankAccounts,
  updateBankAccount,
} from '../services/bankAccount.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { companyMiddleware } from '../middleware/company.middleware.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

router.use(authMiddleware, companyMiddleware);

router.get('/', listBankAccounts);
router.post(
  '/',
  validateBody('bank_id', 'alias', 'agency', 'account_number', 'type'),
  createBankAccount,
);
router.get('/:id', getBankAccount);
router.patch('/:id', updateBankAccount);
router.delete('/:id', deleteBankAccount);

export default router;
