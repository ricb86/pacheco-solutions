/**
 * PACHECO SOLUTIONS — Rotas do plano de contas (módulo financeiro EXTAT)
 *
 * Montado em /companies/coa (contrato EXTAT):
 *   GET  /            → árvore completa
 *   GET  /list/:type  → lista plana por tipo (campos de seleção)
 *   POST /            → criar conta
 *   GET/PATCH/DELETE /:id
 */

import { Router } from 'express';
import {
  createCoa,
  deleteCoa,
  getCoa,
  listCoa,
  listCoaByType,
  updateCoa,
} from '../services/coa.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { companyMiddleware } from '../middleware/company.middleware.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

router.use(authMiddleware, companyMiddleware);

router.get('/', listCoa);
router.get('/list/:type', listCoaByType);
router.post('/', validateBody('label', 'type'), createCoa);
router.get('/:id', getCoa);
router.patch('/:id', updateCoa);
router.delete('/:id', deleteCoa);

export default router;
