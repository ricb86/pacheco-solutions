-- ═══════════════════════════════════════════════════════════════
-- ExtAT Platform — Schema do banco (SQLite embutido)
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
