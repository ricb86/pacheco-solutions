/**
 * PACHECO SOLUTIONS — Camada de banco de dados
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
const MONEY_COLUMNS = new Set([
  'balance',
  'amount',
  // módulo financeiro EXTAT (fase 1)
  'opening_balance',
  'current_balance',
  'average_billing',
  'paid_amount',
  'remaining_amount',
  'total_amount',
  'open_amount',
]);

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
  // rede de segurança: undefined → null (parâmetro nulo do SQL)
  const params = (values ?? []).map((v) => (v === undefined ? null : v));
  const rows = statement.all(...params) as Record<string, unknown>[];
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

-- ═══════════════════════════════════════════════════════════
-- MÓDULO FINANCEIRO (escopo EXTAT — fase 1)
--   empresas multi-empresa · contas bancárias · plano de contas
--   · centros de custo · fornecedores · movimentações com
--   vencimento/pagamentos parciais/estorno (livro-caixa)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  name            TEXT NOT NULL,
  trade_name      TEXT,
  document        TEXT NOT NULL,
  business        TEXT,
  email           TEXT,
  phone           TEXT,
  website         TEXT,
  tax_regime      TEXT,
  average_billing INTEGER NOT NULL DEFAULT 0,
  founded_at      TEXT,
  address         TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS company_members (
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL DEFAULT 'member'
                CHECK (role IN ('owner','admin','member','viewer')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (company_id, user_id)
);

CREATE TABLE IF NOT EXISTS banks (
  id         TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bank_accounts (
  id              TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_id         TEXT NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
  alias           TEXT NOT NULL,
  agency          TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('corrente','poupanca','investimento')),
  opening_balance INTEGER NOT NULL DEFAULT 0,
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code        TEXT,
  label       TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('receita','despesa','ativo','passivo','patrimonio_liquido')),
  parent_id   INTEGER REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  is_title    INTEGER NOT NULL DEFAULT 0,
  is_default  INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cost_centers (
  id         TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  document   TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS financial_transactions (
  id                     TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  company_id             TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL CHECK (type IN ('receita','despesa')),
  amount                 INTEGER NOT NULL CHECK (amount > 0),
  reference              TEXT NOT NULL,
  more_infos             TEXT,
  contact                TEXT,
  url                    TEXT,
  competence             TEXT NOT NULL,
  due_date               TEXT,
  origin                 TEXT NOT NULL DEFAULT 'bank_account'
                           CHECK (origin IN ('bank_account','credit_card')),
  coa_id                 INTEGER REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  bank_account_id        TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  credit_card_account_id TEXT,
  cost_center_id         TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
  supplier_id            TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  tags                   TEXT,
  created_by             TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((origin = 'bank_account' AND bank_account_id IS NOT NULL AND due_date IS NOT NULL)
      OR (origin = 'credit_card' AND credit_card_account_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS transaction_payments (
  id                  TEXT PRIMARY KEY DEFAULT ${UUID_DEFAULT},
  transaction_id      TEXT NOT NULL REFERENCES financial_transactions(id) ON DELETE CASCADE,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount              INTEGER NOT NULL CHECK (amount != 0),
  kind                TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','reversal')),
  reverses_payment_id TEXT REFERENCES transaction_payments(id) ON DELETE SET NULL,
  payment_date        TEXT NOT NULL,
  payment_method      TEXT NOT NULL CHECK (payment_method IN
                        ('dinheiro_ou_pix','debito','credito','transferencia','boleto','outros')),
  bank_account_id     TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  reason              TEXT,
  idempotency_key     TEXT UNIQUE,
  created_by          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_company       ON bank_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_coa_company                ON chart_of_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_ftx_company                ON financial_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_ftx_coa                    ON financial_transactions(coa_id);
CREATE INDEX IF NOT EXISTS idx_ftx_bank_account           ON financial_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_ftx_due_date               ON financial_transactions(due_date);
CREATE INDEX IF NOT EXISTS idx_ftx_competence             ON financial_transactions(competence);
CREATE INDEX IF NOT EXISTS idx_pay_transaction            ON transaction_payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_pay_bank_account           ON transaction_payments(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_pay_company                ON transaction_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_pay_idempotency            ON transaction_payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_company_members_user       ON company_members(user_id);
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
