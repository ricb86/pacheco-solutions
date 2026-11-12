-- ═══════════════════════════════════════════════════════════════
-- PACHECO SOLUTIONS — Schema do banco (SQLite embutido)
--
-- Este é o schema aplicado automaticamente pelo servidor no boot
-- (src/config/database.ts). Arquivo de referência/documentação.
--
-- Diferenças em relação ao schema PostgreSQL original (legacy/):
--   - UUID v4 gerado pelo SQLite via randomblob() (gen_random_uuid)
--   - dinheiro em CENTAVOS (INTEGER) — aritmética exata
--     (a API converte para reais automaticamente nas respostas)
--   - timestamps como TEXT ISO (datetime('now'))
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  username      TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  cpf           TEXT UNIQUE,
  balance       INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),  -- centavos
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  sender_id   TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  receiver_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  amount      INTEGER NOT NULL CHECK (amount > 0),                -- centavos
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
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
--
--   dinheiro em CENTAVOS; a API converte para reais na saída
--   (src/config/database.ts → MONEY_COLUMNS)
--   status das movimentações é DERIVADO, não armazenado
--   (src/utils/finance.ts → STATUS_SQL)
-- ═══════════════════════════════════════════════════════════

-- Empresas (multi-empresa; acesso via company_members)
CREATE TABLE IF NOT EXISTS companies (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  name            TEXT NOT NULL,
  trade_name      TEXT,
  document        TEXT NOT NULL,
  business        TEXT,
  email           TEXT,
  phone           TEXT,
  website         TEXT,
  tax_regime      TEXT,
  average_billing INTEGER NOT NULL DEFAULT 0,                 -- centavos/mês
  founded_at      TEXT,
  address         TEXT,                                       -- JSON
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

-- Catálogo de bancos (global; código Comp)
CREATE TABLE IF NOT EXISTS banks (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  code       TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contas bancárias (por empresa; saldo atual é DERIVADO dos pagamentos)
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  bank_id         TEXT NOT NULL REFERENCES banks(id) ON DELETE RESTRICT,
  alias           TEXT NOT NULL,
  agency          TEXT NOT NULL,
  account_number  TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('corrente','poupanca','investimento')),
  opening_balance INTEGER NOT NULL DEFAULT 0,                  -- centavos (imutável)
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Plano de contas (hierárquico; id INTEGER — contrato EXTAT usa coa_id integer)
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
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS suppliers (
  id         TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  document   TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Movimentações (receitas/despesas; origem = conta bancária OU cartão)
CREATE TABLE IF NOT EXISTS financial_transactions (
  id                     TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  company_id             TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  type                   TEXT NOT NULL CHECK (type IN ('receita','despesa')),
  amount                 INTEGER NOT NULL CHECK (amount > 0),  -- centavos (valor total)
  reference              TEXT NOT NULL,                         -- descrição/título
  more_infos             TEXT,
  contact                TEXT,
  url                    TEXT,
  competence             TEXT NOT NULL,                         -- 'AAAA-MM'
  due_date               TEXT,                                  -- 'AAAA-MM-DD'
  origin                 TEXT NOT NULL DEFAULT 'bank_account'
                           CHECK (origin IN ('bank_account','credit_card')),
  coa_id                 INTEGER REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
  bank_account_id        TEXT REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  credit_card_account_id TEXT,                                 -- fase 3 (cartões)
  cost_center_id         TEXT REFERENCES cost_centers(id) ON DELETE SET NULL,
  supplier_id            TEXT REFERENCES suppliers(id) ON DELETE SET NULL,
  tags                   TEXT,                                 -- JSON array
  created_by             TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((origin = 'bank_account' AND bank_account_id IS NOT NULL AND due_date IS NOT NULL)
      OR (origin = 'credit_card' AND credit_card_account_id IS NOT NULL))
);

-- Livro-caixa de pagamentos (estorno = linha kind='reversal' com valor NEGATIVO)
CREATE TABLE IF NOT EXISTS transaction_payments (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))),
  transaction_id      TEXT NOT NULL REFERENCES financial_transactions(id) ON DELETE CASCADE,
  company_id          TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  amount              INTEGER NOT NULL CHECK (amount != 0),   -- centavos; reversal < 0
  kind                TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment','reversal')),
  reverses_payment_id TEXT REFERENCES transaction_payments(id) ON DELETE SET NULL,
  payment_date        TEXT NOT NULL,                            -- 'AAAA-MM-DD'
  payment_method      TEXT NOT NULL CHECK (payment_method IN
                        ('dinheiro_ou_pix','debito','credito','transferencia','boleto','outros')),
  bank_account_id     TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  reason              TEXT,
  idempotency_key     TEXT UNIQUE,
  created_by          TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Transferências entre contas da mesma empresa (fase 2)
CREATE TABLE IF NOT EXISTS bank_transfers (
  id              TEXT PRIMARY KEY,
  company_id      TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  from_account_id TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  to_account_id   TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  transfer_date   TEXT NOT NULL,
  description     TEXT,
  created_by      TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (from_account_id <> to_account_id)
);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_company ON bank_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_transfers_company     ON bank_transfers(company_id);
CREATE INDEX IF NOT EXISTS idx_transfers_from        ON bank_transfers(from_account_id);
CREATE INDEX IF NOT EXISTS idx_transfers_to          ON bank_transfers(to_account_id);
CREATE INDEX IF NOT EXISTS idx_coa_company           ON chart_of_accounts(company_id);
CREATE INDEX IF NOT EXISTS idx_ftx_company           ON financial_transactions(company_id);
CREATE INDEX IF NOT EXISTS idx_ftx_coa               ON financial_transactions(coa_id);
CREATE INDEX IF NOT EXISTS idx_ftx_bank_account      ON financial_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_ftx_due_date         ON financial_transactions(due_date);
CREATE INDEX IF NOT EXISTS idx_ftx_competence        ON financial_transactions(competence);
CREATE INDEX IF NOT EXISTS idx_pay_transaction       ON transaction_payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_pay_bank_account      ON transaction_payments(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_pay_company           ON transaction_payments(company_id);
CREATE INDEX IF NOT EXISTS idx_pay_idempotency       ON transaction_payments(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_company_members_user  ON company_members(user_id);
