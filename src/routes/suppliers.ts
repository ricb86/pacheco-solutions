/**
 * PACHECO SOLUTIONS — Rotas de fornecedores (módulo financeiro EXTAT)
 *
 * Escopo por empresa via header `x-company-id`.
 */

import { Router } from 'express';
import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier,
} from '../services/supplier.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { companyMiddleware } from '../middleware/company.middleware.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

router.use(authMiddleware, companyMiddleware);

router.get('/', listSuppliers);
router.post('/', validateBody('name', 'document'), createSupplier);
router.get('/:id', getSupplier);
router.patch('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);

export default router;
