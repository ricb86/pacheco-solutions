/**
 * PACHECO SOLUTIONS — Rotas de empresas (módulo financeiro EXTAT)
 *
 * Montado em /companies. IMPORTANTE: /companies/coa e
 * /companies/transactions são montados ANTES deste router no barrel
 * (a ordem de registro do Express importa).
 */

import { Router } from 'express';
import {
  addMember,
  createCompany,
  deleteCompany,
  getCompany,
  listCompanies,
  listMembers,
  removeMember,
  updateCompany,
  updateMemberRole,
} from '../services/company.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

router.use(authMiddleware);

router.get('/', listCompanies);
router.post(
  '/',
  validateBody('name', 'document', 'business'),
  createCompany,
);
router.get('/:id', getCompany);
router.patch('/:id', updateCompany);
router.delete('/:id', deleteCompany);
router.get('/:id/members', listMembers);
router.post('/:id/members', addMember);
router.patch('/:id/members/:userId', updateMemberRole);
router.delete('/:id/members/:userId', removeMember);

export default router;
