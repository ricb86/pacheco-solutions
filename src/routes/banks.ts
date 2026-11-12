/**
 * PACHECO SOLUTIONS — Rotas do catálogo de bancos (módulo financeiro EXTAT)
 */

import { Router } from 'express';
import { createBank, listBanks } from '../services/bankAccount.service.ts';
import { authMiddleware } from '../middleware/auth.middleware.ts';
import { validateBody } from '../middleware/validation.ts';

const router = Router();

router.use(authMiddleware);

router.get('/', listBanks);
router.post('/', validateBody('code', 'label'), createBank);

export default router;
