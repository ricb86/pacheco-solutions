/**
 * PACHECO SOLUTIONS — Utilitários do módulo financeiro
 *
 * Helpers compartilhados entre os serviços financeiros (escopo EXTAT):
 * conversão de dinheiro, parsing de parâmetros de listagem e validações.
 */

import type { SQLParam } from '../config/database.ts';

/** Converte reais informados na API para centavos (inteiros exatos). */
export function toCents(amount: unknown): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

/** Centavos (inteiros) → reais. */
export function centsToReal(cents: unknown): number {
  return Math.round(Number(cents ?? 0)) / 100;
}

/**
 * Parâmetro de lista: aceita string separada por vírgula, array ou valor
 * único → array de strings não-vazias. (EXTAT: `?status=pago,vencido`)
 */
export function parseListParam(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return raw.map((v) => String(v).trim()).filter(Boolean);
}

/** Valida formato 'YYYY-MM-DD'. */
export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** Valida formato 'YYYY-MM' (mês de competência), incluindo faixa 01–12. */
export function isIsoMonth(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) return false;
  const month = Number(value.slice(5, 7));
  return month >= 1 && month <= 12;
}

/** Sanitiza texto livre (null se vazio). */
export function textOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Construtor de WHERE dinâmico com placeholders $n (dialeto PostgreSQL). */
export class WhereBuilder {
  private clauses: string[] = [];
  private params: SQLParam[] = [];

  add(condition: string, ...values: SQLParam[]): this {
    this.clauses.push(condition);
    this.params.push(...values);
    return this;
  }

  /** Adiciona `col IN (…)` a partir de lista; ignora se vazia. */
  addIn(column: string, values: string[]): this {
    if (!values.length) return this;
    const placeholders = values.map((_, i) => `$${this.params.length + i + 1}`);
    this.clauses.push(`${column} IN (${placeholders.join(', ')})`);
    this.params.push(...values);
    return this;
  }

  get sql(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }

  get values(): SQLParam[] {
    return this.params;
  }
}

export const PAYMENT_METHODS = [
  'dinheiro_ou_pix',
  'debito',
  'credito',
  'transferencia',
  'boleto',
  'outros',
] as const;

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  dinheiro_ou_pix: 'Dinheiro ou PIX',
  debito: 'Cartão de débito',
  credito: 'Cartão de crédito',
  transferencia: 'Transferência bancária',
  boleto: 'Boleto',
  outros: 'Outros',
};

export const TRANSACTION_STATUSES = [
  'pago',
  'pago_parcial',
  'vence_hoje',
  'a_vencer',
  'vencido',
] as const;

export const STATUS_LABELS: Record<string, string> = {
  pago: 'Pago',
  pago_parcial: 'Pago parcial',
  vence_hoje: 'Vence hoje',
  a_vencer: 'A vencer',
  vencido: 'Vencido',
};

/**
 * SQL do status derivado (mesma regra aplicada em listagem, filtro e
 * leitura unitária). Precedência: pago > vencido > vence_hoje >
 * pago_parcial > a_vencer.
 */
export const STATUS_SQL = `CASE
  WHEN COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                  WHERE p.transaction_id = t.id), 0) >= t.amount THEN 'pago'
  WHEN t.due_date IS NOT NULL AND t.due_date < date('now') THEN 'vencido'
  WHEN t.due_date IS NOT NULL AND t.due_date = date('now') THEN 'vence_hoje'
  WHEN COALESCE((SELECT SUM(p.amount) FROM transaction_payments p
                  WHERE p.transaction_id = t.id), 0) > 0 THEN 'pago_parcial'
  ELSE 'a_vencer'
END`;
