/**
 * PACHECO SOLUTIONS — Rotas de centros de custo (módulo financeiro EXTAT)
 *
 * Escopo por empresa via header `x-company-id`.
 */

import { Router } from 'express';
import {
  createCostCenter,
  deleteCostCenter,
  getCostCenter,
  listCostCenters,
  updateCostCenter,
} from '../services/costCenter.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { companyMiddleware } from '../middleware/company.middleware.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

router.use(authMiddleware, companyMiddleware);

router.get('/', listCostCenters);
router.post('/', validateBody('name'), createCostCenter);
router.get('/:id', getCostCenter);
router.patch('/:id', updateCostCenter);
router.delete('/:id', deleteCostCenter);

export default router;
