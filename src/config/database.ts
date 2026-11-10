import { Pool, QueryResult } from 'pg';
import { config } from './env.js';

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database
});

export async function query<T = any>(text: string, values?: any[]): Promise<QueryResult<T>> {
  return pool.query(text, values || []);
}

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    console.log('✅ Conexão com PostgreSQL estabelecida!');
  } finally {
    client.release();
  }
}

export default pool;
