/**
 * PACHECO SOLUTIONS — Rotas de relatórios financeiros (fase 2)
 */

import { Router } from 'express';
import {
  getDashboard,
  getDre,
  getCashFlow,
} from '../services/report.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { companyMiddleware } from '../middleware/company.middleware.ts';

const router = Router();

router.use(authMiddleware, companyMiddleware);

router.get('/dashboard', getDashboard);
router.get('/dre', getDre);
router.get('/cash-flow', getCashFlow);

export default router;
