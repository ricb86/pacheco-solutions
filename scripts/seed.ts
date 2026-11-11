/**
 * PACHECO SOLUTIONS — Seed de dados de demonstração
 *
 * Cria usuários de teste com saldo inicial (idempotente — pode rodar
 * quantas vezes quiser; usuários existentes não são duplicados).
 *
 *   deno task seed
 *
 * Contas criadas:
 *   admin@pacheco.local  / Admin@123  (role: admin, saldo R$ 1.000,00)
 *   maria@pacheco.local  / Maria@123  (saldo R$ 500,00)
 *   joao@pacheco.local   / Joao@123   (saldo R$ 250,00)
 */

import bcrypt from 'bcryptjs';
import { connectDatabase, query } from '../src/config/database.ts';
import { config } from '../src/config/env.ts';
import { logger } from '../src/utils/logger.ts';

interface SeedUser {
  username: string;
  email: string;
  password: string;
  name: string;
  role: 'user' | 'admin';
  balanceCents: number;
}

const DEMO_USERS: SeedUser[] = [
  {
    username: 'admin',
    email: 'admin@pacheco.local',
    password: 'Admin@123',
    name: 'Administrador Pacheco',
    role: 'admin',
    balanceCents: 100_000, // R$ 1.000,00
  },
  {
    username: 'maria',
    email: 'maria@pacheco.local',
    password: 'Maria@123',
    name: 'Maria Silva',
    role: 'user',
    balanceCents: 50_000, // R$ 500,00
  },
  {
    username: 'joao',
    email: 'joao@pacheco.local',
    password: 'Joao@123',
    name: 'João Souza',
    role: 'user',
    balanceCents: 25_000, // R$ 250,00
  },
];

async function seed() {
  await connectDatabase();

  let created = 0;
  for (const user of DEMO_USERS) {
    const existing = await query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [user.email, user.username],
    );
    if (existing.rows.length > 0) {
      logger.info(`↷ ${user.email} já existe — ignorado`);
      continue;
    }

    const passwordHash = await bcrypt.hash(user.password, config.bcryptSaltRounds);
    await query(
      `INSERT INTO users (username, email, password_hash, name, balance, role)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        user.username,
        user.email,
        passwordHash,
        user.name,
        user.balanceCents,
        user.role,
      ],
    );
    created++;
    logger.info(
      `✚ ${user.email} criado (saldo R$ ${(user.balanceCents / 100).toFixed(2)})`,
    );
  }

  logger.info(
    created > 0
      ? `🌱 Seed concluído: ${created} usuário(s) criado(s).`
      : '🌱 Seed concluído: nada a fazer (dados já existem).',
  );
}

seed().catch((error) => {
  logger.error('Falha no seed:', error);
  Deno.exit(1);
});
