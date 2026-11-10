import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/database.js';
import { config } from '../config/env.js';
import pool from '../config/database.js';

const router = Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password, name, cpf } = req.body;

    // Verificar se usuário já existe
    const existingUser = await query('SELECT id FROM users WHERE email = $1 OR username = $2', [email, username]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Usuário ou email já cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(
      'INSERT INTO users (username, email, password_hash, name, cpf) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, email, name, role',
      [username, email, passwordHash, name, cpf || null]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, config.jwt.secret, { expiresIn: '24h' });

    res.status(201).json({ message: 'Usuário criado com sucesso!', user, token });
  } catch (error) {
    console.error('Erro no register:', error);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, config.jwt.secret, { expiresIn: '24h' });

    res.json({ message: 'Login realizado com sucesso!', user: { id: user.id, username: user.username, email: user.email, name: user.name, role: user.role }, token });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login.' });
  }
});

export default router;
