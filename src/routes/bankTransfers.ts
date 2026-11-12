/**
 * PACHECO SOLUTIONS — Rotas de transferências entre contas bancárias
 */

import { Router } from 'express';
import {
  listTransfers,
  createTransfer,
  deleteTransfer,
} from '../services/bankTransfer.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { companyMiddleware } from '../middleware/company.middleware.ts';

const router = Router();

router.use(authMiddleware, companyMiddleware);

router.get('/', listTransfers);
router.post('/', createTransfer);
router.delete('/:id', deleteTransfer);

export default router;
