import { getClient } from '../config/database.js';

export const createTransaction = async (req: any, res: any) => {
  try {
    const { receiver_username, amount, description } = req.body;
    const senderId = req.user.id;

    if (!receiver_username || !amount) {
      return res.status(400).json({ message: 'Receiver username e amount são obrigatórios' });
    }

    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Buscar receptor
      const receiverResult = await client.query(
        'SELECT id, balance FROM users WHERE username = $1 FOR UPDATE',
        [receiver_username]
      );
      
      if (receiverResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Receptor não encontrado' });
      }

      const receiver = receiverResult.rows[0];

      // Verificar saldo
      const userBalance = await client.query(
        'SELECT balance FROM users WHERE id = $1',
        [senderId]
      );
      
      if (parseFloat(userBalance.rows[0].balance) < parseFloat(amount.toString())) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Saldo insuficiente' });
      }

      // Criar transação
      const result = await client.query(
        `INSERT INTO transactions (sender_id, receiver_id, amount, description, status)
         VALUES ($1, $2, $3, $4, 'completed')
         RETURNING *`,
        [senderId, receiver.id, amount, description || null]
      );

      // Atualizar saldos
      await client.query(
        `UPDATE users SET balance = balance - $1 WHERE id = $2`,
        [amount, senderId]
      );
      
      await client.query(
        `UPDATE users SET balance = balance + $1 WHERE id = $2`,
        [amount, receiver.id]
      );

      await client.query('COMMIT');

      res.status(201).json({ transaction: result.rows[0], message: 'Transferência realizada com sucesso!' });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Erro ao criar transação:', error);
    res.status(500).json({ message: 'Erro interno no servidor' });
  }
};

export const getTransactions = async (req: any, res: any) => {
  try {
    const userId = req.user.id;
    
    const result = await query(
      `SELECT t.*, 
              s.username as sender_username,
              r.username as receiver_username
       FROM transactions t
       LEFT JOIN users s ON t.sender_id = s.id
       LEFT JOIN users r ON t.receiver_id = r.id
       WHERE t.sender_id = $1 OR t.receiver_id = $2
       ORDER BY created_at DESC`,
      [userId, userId]
    );

    res.json({ transactions: result.rows });
  } catch (error) {
    console.error('Erro ao listar transações:', error);
    res.status(500).json({ message: 'Erro interno no servidor' });
  }
};
