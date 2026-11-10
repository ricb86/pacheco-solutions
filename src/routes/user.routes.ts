import { Router } from 'express';
import { query } from '../config/database.js';
import { authMiddleware, AuthRequest } from '../middleware/auth.middleware.js';

const router = Router();

// Listar usuários (admin)
router.get('/', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await query('SELECT id, username, email, name, role, created_at FROM users ORDER BY created_at DESC');
    res.json({ users: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// Perfil do usuário
router.get('/profile', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await query('SELECT id, username, email, name, role, created_at FROM users WHERE id = $1', [req.user!.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar perfil.' });
  }
});

// Buscar usuário por ID
router.get('/:id', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const result = await query('SELECT id, username, email, name, role, created_at FROM users WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar usuário.' });
  }
});

export default router;
