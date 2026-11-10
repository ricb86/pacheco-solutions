/**
 * ExtAT Platform — Configuração de ambiente
 *
 * Carrega o arquivo .env da raiz do projeto (sem depender de pacotes externos)
 * e expõe a configuração validada para o restante da aplicação.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz do projeto (pasta que contém src/, .env, deno.json) */
export const PROJECT_ROOT = resolve(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

/** Lê o .env da raiz do projeto e aplica as variáveis não definidas. */
function loadEnvFile(): void {
  const envPath = join(PROJECT_ROOT, '.env');
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, 'utf-8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // Remove aspas envolvendo o valor
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Não sobrescreve variáveis já definidas no ambiente
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error(
    '❌ JWT_SECRET não configurado! Crie o arquivo .env a partir de .env.example',
  );
  Deno.exit(1);
}

/** Resolve caminhos relativos contra a raiz do projeto. */
function resolvePath(value: string | undefined, fallback: string): string {
  const p = value?.trim() || fallback;
  return isAbsolute(p) ? p : join(PROJECT_ROOT, p);
}

export const config = {
  isProduction: process.env.NODE_ENV === 'production',

  port: Number(process.env.PORT) || 3001,

  /** Arquivo do banco SQLite embutido */
  dbPath: resolvePath(process.env.DB_PATH, './data/extat.db'),

  jwt: {
    secret: JWT_SECRET,
    expiresIn: process.env.AUTH_TOKEN_EXPIRATION || '24h',
  },

  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,

  corsOrigins: (process.env.CORS_ORIGIN ||
    'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const;
