import { Router } from 'express';
import { createTransaction, getTransactions } from '../services/transaction.service.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', authMiddleware, getTransactions);
router.post('/create', authMiddleware, createTransaction);

export default router;
