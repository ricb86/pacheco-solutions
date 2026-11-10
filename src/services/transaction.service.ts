/**
 * ExtAT Platform — Serviço de transações (transferências P2P)
 *
 * Correções em relação ao original:
 *   - getTransactions usava `query` sem importá-lo
 *   - `FOR UPDATE` não existe em SQLite (removido — a transação é serializada
 *     pelo adaptador, garantindo a mesma atomicidade)
 *   - verificação de saldo movida para o SQL (dinheiro em centavos, sem erro
 *     de ponto flutuante)
 *   - validação do valor informado
 */

import type { Response } from 'express';
import { getClient, query } from '../config/database.ts';
import type { AuthRequest } from '../middleware/auth.middleware.ts';

/** Converte reais informados na API para centavos (inteiros exatos). */
function toCents(amount: unknown): number {
  const value = Number(amount);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

export const createTransaction = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  const senderId = req.user!.id;

  try {
    const { receiver_username, amount, description } = req.body ?? {};

    if (!receiver_username) {
      res.status(400).json({
        error: 'receiver_username e amount são obrigatórios.',
      });
      return;
    }

    const amountCents = toCents(amount);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      res.status(400).json({
        error: 'Valor inválido — informe um número maior que zero.',
      });
      return;
    }

    if (receiver_username === req.user!.username) {
      res.status(400).json({
        error: 'Não é possível transferir para si mesmo.',
      });
      return;
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Buscar receptor
      const receiverResult = await client.query(
        'SELECT id, username FROM users WHERE username = $1',
        [receiver_username],
      );
      if (receiverResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Receptor não encontrado.' });
        return;
      }
      const receiver = receiverResult.rows[0] as unknown as { id: string };

      // Verificar saldo e criar a transação em uma única instrução atômica
      const insertResult = await client.query(
        `INSERT INTO transactions (sender_id, receiver_id, amount, description, status)
         SELECT $1, $2, $3, $4, 'completed'
         WHERE EXISTS (SELECT 1 FROM users WHERE id = $1 AND balance >= $3)
         RETURNING *`,
        [senderId, receiver.id, amountCents, description || null],
      );
      if (insertResult.rows.length === 0) {
        await client.query('ROLLBACK');
        res.status(400).json({ error: 'Saldo insuficiente.' });
        return;
      }

      // Atualizar saldos (em centavos, exato)
      await client.query(
        'UPDATE users SET balance = balance - $1, updated_at = datetime(\'now\') WHERE id = $2',
        [amountCents, senderId],
      );
      await client.query(
        'UPDATE users SET balance = balance + $1, updated_at = datetime(\'now\') WHERE id = $2',
        [amountCents, receiver.id],
      );

      await client.query('COMMIT');

      res.status(201).json({
        message: 'Transferência realizada com sucesso!',
        transaction: insertResult.rows[0],
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.release();
    }
  } catch (error) {
    console.error('Erro ao criar transação:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};

export const getTransactions = async (
  req: AuthRequest,
  res: Response,
): Promise<void> => {
  try {
    const userId = req.user!.id;

    const result = await query(
      `SELECT t.*,
              s.username as sender_username,
              r.username as receiver_username
       FROM transactions t
       LEFT JOIN users s ON t.sender_id = s.id
       LEFT JOIN users r ON t.receiver_id = r.id
       WHERE t.sender_id = $1 OR t.receiver_id = $2
       ORDER BY t.created_at DESC`,
      [userId, userId],
    );

    res.json({ transactions: result.rows });
  } catch (error) {
    console.error('Erro ao listar transações:', error);
    res.status(500).json({ error: 'Erro interno no servidor.' });
  }
};
