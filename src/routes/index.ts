/**
 * ExtAT Platform — Barrel de rotas
 * (este arquivo era importado como @routes no original mas não existia)
 */

import { Router } from 'express';
import authRoutes from './auth.ts';
import userRoutes from './users.ts';
import transactionRoutes from './transactions.ts';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/transactions', transactionRoutes);

export default router;
