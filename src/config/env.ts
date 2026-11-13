/**
 * PACHECO SOLUTIONS — Configuração de ambiente
 *
 * Funciona em dois modos:
 *
 *  1. Desenvolvimento (deno run): raiz = pasta do projeto; banco em data/.
 *  2. Instalado (binário do `deno compile`): raiz = pasta do executável
 *     (contém public/); dados, configuração e estado em diretórios XDG:
 *       ~/.config/pacheco-solutions   → .env (JWT_SECRET gerado no 1º uso)
 *       ~/.local/share/pacheco-solutions → pacheco.db
 *       ~/.local/state/pacheco-solutions → logs/PID (usados pelo launcher)
 *
 * Variáveis de ambiente podem sobrescrever tudo:
 *  PACHECO_HOME, PACHECO_CONFIG_DIR, PACHECO_DATA_DIR, PACHECO_STATE_DIR,
 *  PORT, DB_PATH, JWT_SECRET, etc.
 */

import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Raiz do código-fonte (pasta que contém src/, public/, deno.json). */
const DEV_ROOT = resolve(
  dirname(dirname(dirname(fileURLToPath(import.meta.url)))),
);

/** true quando executado como binário compilado (`deno compile`). */
const IS_STANDALONE = Deno.build.standalone;

/** HOME do usuário (fallback para ambientes sem $HOME). */
const HOME = process.env.HOME?.trim() || '.';

/** Resolve um diretório XDG (ou variável própria) com fallback. */
function dirFromEnv(envVar: string, xdgVar: string, xdgFallback: string): string {
  const custom = process.env[envVar]?.trim();
  if (custom) return resolve(custom);

  const base = process.env[xdgVar]?.trim();
  const root = base && isAbsolute(base) ? base : join(HOME, xdgFallback);
  return join(root, 'pacheco-solutions');
}

/**
 * Raiz de instalação: onde ficam o executável e a pasta public/.
 * - instalado: pasta do binário (ou PACHECO_HOME)
 * - desenvolvimento: raiz do projeto
 */
export const PROJECT_ROOT = (() => {
  const custom = process.env.PACHECO_HOME?.trim();
  if (custom) return resolve(custom);
  return IS_STANDALONE ? dirname(Deno.execPath()) : DEV_ROOT;
})();

/** Diretórios de configuração, dados e estado. */
const CONFIG_DIR = IS_STANDALONE
  ? dirFromEnv('PACHECO_CONFIG_DIR', 'XDG_CONFIG_HOME', '.config')
  : PROJECT_ROOT;

const DATA_DIR = IS_STANDALONE
  ? dirFromEnv('PACHECO_DATA_DIR', 'XDG_DATA_HOME', '.local/share')
  : join(PROJECT_ROOT, 'data');

const STATE_DIR = IS_STANDALONE
  ? dirFromEnv('PACHECO_STATE_DIR', 'XDG_STATE_HOME', '.local/state')
  : DATA_DIR;

/** Lê o .env (config dir no modo instalado; raiz no desenvolvimento). */
function loadEnvFile(): void {
  const candidates = [
    join(CONFIG_DIR, '.env'),
    join(PROJECT_ROOT, '.env'),
  ];

  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;

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

    return; // o primeiro arquivo encontrado tem precedência
  }
}

loadEnvFile();

/** Gera um segredo aleatório de 64 caracteres hexadecimais. */
function generateJwtSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * No modo instalado, cria o JWT_SECRET automaticamente na primeira execução
 * (arquivo .env no diretório de configuração, permissão 600).
 */
function ensureJwtSecret(): void {
  if (process.env.JWT_SECRET) return;

  if (!IS_STANDALONE) {
    console.error(
      '❌ JWT_SECRET não configurado! Crie o arquivo .env a partir de .env.example',
    );
    Deno.exit(1);
  }

  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });

  const envPath = join(CONFIG_DIR, '.env');
  const secret = generateJwtSecret();

  if (existsSync(envPath)) {
    appendFileSync(envPath, `\nJWT_SECRET=${secret}\n`);
  } else {
    writeFileSync(
      envPath,
      [
        '# PACHECO SOLUTIONS — configuração local (gerada automaticamente)',
        '# Edite com cuidado. Reinicie o aplicativo após alterações.',
        `JWT_SECRET=${secret}`,
        'PORT=3001',
        'NODE_ENV=production',
        'AUTH_TOKEN_EXPIRATION=7d',
        '',
      ].join('\n'),
      { mode: 0o600 },
    );
  }

  chmodSync(envPath, 0o600);
  process.env.JWT_SECRET = secret;
  // Coerência no primeiro uso: o .env recém-criado define NODE_ENV=production.
  if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';

  console.log(`🔐 Segredo JWT gerado em ${envPath}`);
}

ensureJwtSecret();

/** Resolve o caminho do banco: absoluto, relativo aos dados, ou padrão. */
function resolveDbPath(value: string | undefined): string {
  const p = value?.trim();
  if (!p) return join(DATA_DIR, 'pacheco.db');
  if (isAbsolute(p)) return p;

  // Relativo: no modo instalado, relativo ao diretório de dados
  // (a pasta do binário pode ser somente leitura).
  return join(IS_STANDALONE ? DATA_DIR : PROJECT_ROOT, p);
}

export const config = {
  isProduction: process.env.NODE_ENV === 'production',

  /** true quando rodando a partir do binário instalado. */
  isStandalone: IS_STANDALONE,

  /** Interface de rede: desktop instala só em localhost. */
  host: process.env.HOST?.trim() ||
    (IS_STANDALONE ? '127.0.0.1' : '0.0.0.0'),

  port: Number(process.env.PORT) || 3001,

  /** Arquivo do banco SQLite embutido */
  dbPath: resolveDbPath(process.env.DB_PATH),

  /** Diretórios usados no modo instalado */
  installRoot: PROJECT_ROOT,
  configDir: CONFIG_DIR,
  dataDir: DATA_DIR,
  stateDir: STATE_DIR,

  /** Interface web (public/) — ao lado do binário quando instalado. */
  publicDir: join(PROJECT_ROOT, 'public'),

  jwt: {
    secret: process.env.JWT_SECRET as string,
    expiresIn: process.env.AUTH_TOKEN_EXPIRATION || '24h',
  },

  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS) || 10,

  corsOrigins: (process.env.CORS_ORIGIN ||
    'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
} as const;
