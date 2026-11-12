/**
 * PACHECO SOLUTIONS — Barrel de rotas
 * (este arquivo era importado como @routes no original mas não existia)
 *
 * ORDEM DE MONTAGEM (o Express respeita a ordem de registro):
 *   /companies/coa e /companies/transactions ANTES de /companies,
 *   senão /companies/:id capturaria "coa" e "transactions" como id.
 */

import { Router } from 'express';
import authRoutes from './auth.ts';
import userRoutes from './users.ts';
import transactionRoutes from './transactions.ts';
import companiesRoutes from './companies.ts';
import banksRoutes from './banks.ts';
import bankAccountRoutes from './bankAccounts.ts';
import coaRoutes from './coa.ts';
import supplierRoutes from './suppliers.ts';
import costCenterRoutes from './costCenters.ts';
import financeTransactionRoutes from './financeTransactions.ts';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/transactions', transactionRoutes); // carteira P2P (extra mantido)

// módulo financeiro (escopo EXTAT)
router.use('/banks', banksRoutes);
router.use('/companies/coa', coaRoutes);
router.use('/companies/transactions', financeTransactionRoutes);
router.use('/companies', companiesRoutes);
router.use('/bank-accounts', bankAccountRoutes);
router.use('/cost-centers', costCenterRoutes);
router.use('/suppliers', supplierRoutes);

export default router;
