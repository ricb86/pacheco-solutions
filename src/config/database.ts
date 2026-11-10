/**
 * ExtAT Platform — Camada de banco de dados
 *
 * ADAPTAÇÃO DO RESGATE: o projeto original usava PostgreSQL (docker-compose).
 * Esta máquina não possui Docker/PostgreSQL/Node, apenas Deno — por isso o
 * banco foi portado para SQLite embutido (node:sqlite, sem serviços externos).
 *
 * O adaptador mantém a interface original do código (query / getClient /
 * connectDatabase) e traduz automaticamente:
 *   - placeholders PostgreSQL ($1, $2, …) → placeholders SQLite (?)
 *   - colunas monetárias (balance, amount) em CENTAVOS no banco → REAIS nas
 *     respostas (aritmética de dinheiro sempre exata, em inteiros)
 *   - BEGIN / COMMIT / ROLLBACK continuam funcionando nas transações
 *
 * Consultas SQL continuam sendo escritas no estilo PostgreSQL.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './env.ts';
import { logger } from '../utils/logger.ts';

let db: DatabaseSync;

/** Valores aceitos pelo SQLite (equivalente ao SQLInputValue do node:sqlite). */
export type SQLParam = null | number | bigint | string | Uint8Array;

/** Colunas monetárias armazenadas em centavos → convertidas para reais na saída. */
const MONEY_COLUMNS = new Set(['balance', 'amount']);

/**
 * $1, $2 … → ?1, ?2 (compatibilidade com o dialeto PostgreSQL do código
 * original). Usa placeholders NUMERADOS do SQLite porque o dialeto PostgreSQL
 * permite reusar $1 várias vezes na mesma query — placeholders posicionais "?"
 * exigiriam um argumento novo para cada ocorrência.
 */
function translate(sql: string): string {
  return sql.replace(/\$(\d+)/g, '?$1');
}

/** Converte linhas do banco para o formato da API (dinheiro em reais). */
function normalizeRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] =
        MONEY_COLUMNS.has(key) && typeof value === 'number'
          ? Math.round(value) / 100
          : value;
    }
    return out as unknown as T;
  });
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
}

/**
 * Executa uma consulta SQL (estilo PostgreSQL: placeholders $1, $2, …).
 * Funciona para SELECT, INSERT … RETURNING, UPDATE e DELETE.
 * Atenção: parâmetros NULOS devem ser passados como null, não undefined.
 */
export function query<T = Record<string, unknown>>(
  sql: string,
  values?: SQLParam[],
): QueryResult<T> {
  const statement = db.prepare(translate(sql));
  const rows = statement.all(...(values ?? [])) as Record<string, unknown>[];
  return { rows: normalizeRows<T>(rows), rowCount: rows.length };
}

/**
 * Transações SQL — mesma semântica do pool do PostgreSQL original:
 *   const client = await getClient();
 *   await client.query('BEGIN');
 *   … await client.query(…)
 *   await client.query('COMMIT');
 *   client.release();
 *
 * SQLite tem uma única conexão: as transações são serializadas por um mutex
 * e o release() desfaz automaticamente transações esquecidas (ROLLBACK).
 */
export interface DbClient {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: SQLParam[],
  ): Promise<QueryResult<T>>;
  release(): Promise<void>;
}

let txQueue: Promise<void> = Promise.resolve();

export async function getClient(): Promise<DbClient> {
  // Serializa transações (uma por vez) na conexão única do SQLite
  const previous = txQueue;
  let unlock!: () => void;
  txQueue = new Promise<void>((resolve) => (unlock = resolve));
  await previous;

  let inTransaction = false;

  const controlStatement = (sql: string): boolean => {
    if (/^\s*BEGIN/i.test(sql)) {
      db.exec('BEGIN');
      inTransaction = true;
      return true;
    }
    if (/^\s*COMMIT/i.test(sql)) {
      db.exec('COMMIT');
      inTransaction = false;
      return true;
    }
    if (/^\s*ROLLBACK/i.test(sql)) {
      db.exec('ROLLBACK');
      inTransaction = false;
      return true;
    }
    return false;
  };

  return {
    async query<T = Record<string, unknown>>(sql: string, values?: SQLParam[]) {
      if (controlStatement(sql)) return { rows: [], rowCount: 0 };
      return query<T>(sql, values);
    },
    async release() {
      try {
        if (inTransaction) {
          db.exec('ROLLBACK');
          logger.warn('Transação não finalizada — ROLLBACK automático');
        }
      } finally {
        unlock();
      }
    },
  };
}

/** UUID v4 gerado pelo SQLite (equivalente ao gen_random_uuid() do Postgres). */
const UUID_DEFAULT =
  `(lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
    substr(hex(randomblob(2)), 2) || '-' ||
    substr('89ab', abs(random()) % 4 + 1, 1) ||
    substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))))`;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  cpf           TEXT UNIQUE,
  balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount      INTEGER NOT NULL CHECK (amount > 0),
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'completed', 'failed')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_sender   ON transactions(sender_id);
CREATE INDEX IF NOT EXISTS idx_transactions_receiver ON transactions(receiver_id);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`;

/** Abre o banco, aplica o schema e os PRAGMAs. Chamada no boot do servidor. */
export async function connectDatabase(): Promise<void> {
  mkdirSync(dirname(config.dbPath), { recursive: true });

  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);

  logger.info(`💾 Banco SQLite pronto: ${config.dbPath}`);
}

/** Alias de compatibilidade com o código original. */
export const initDatabase = connectDatabase;
