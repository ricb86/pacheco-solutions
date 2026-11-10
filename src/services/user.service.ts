import { query } from '../config/database.js';

export const getUserProfile = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      'SELECT id, username, email, name, cpf, balance, role, created_at FROM users WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ error: 'Erro ao buscar perfil do usuário.' });
  }
};

export const updateUserProfile = async (req: any, res: any) => {
  try {
    const { id } = req.params;
    const { name, cpf } = req.body;

    const result = await query(
      'UPDATE users SET name = COALESCE($1, name), cpf = COALESCE($2, cpf) WHERE id = $3 RETURNING id, username, email, name, cpf, balance, role',
      [name, cpf, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    res.json({ message: 'Perfil atualizado com sucesso!', user: result.rows[0] });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Erro ao atualizar perfil do usuário.' });
  }
};
