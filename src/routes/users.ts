/**
 * ExtAT Platform — Rotas de usuários
 */

import { Router } from 'express';
import {
  getMyProfile,
  getUserProfile,
  updateUserProfile,
  listUsers,
} from '../services/user.service.ts';
import {
  authMiddleware,
  adminMiddleware,
} from '../middleware/auth.middleware.ts';

const router = Router();

router.use(authMiddleware);

// Próprio perfil
router.get('/profile', getMyProfile);
router.patch('/profile', updateUserProfile);

// Listagem completa — apenas admin
router.get('/', adminMiddleware, listUsers);

// Buscar usuário por ID
router.get('/:id', getUserProfile);

export default router;
