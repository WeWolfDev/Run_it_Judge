const { Pool } = require('pg');
const fs = require('node:fs/promises');
const path = require('node:path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://judge0:RunItJudgePostgres_2026_local@localhost:5432/judge0',
});

async function query(text, values) {
  return pool.query(text, values);
}

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(schema);
  await pool.query(`
    INSERT INTO users (username, access_code, role)
    VALUES ('admin', 'ADMIN-RUN-IT', 'admin'), ('demo', 'RUN-IT-2026', 'participant')
    ON CONFLICT (username) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO problems (name, statement, test_cases)
    SELECT 'Hola mundo', 'Imprime exactamente Hola mundo.', '[{"stdin":"","expected":"Hola mundo\\n"}]'::jsonb
    WHERE NOT EXISTS (SELECT 1 FROM problems WHERE name = 'Hola mundo')
  `);
  await pool.query(`
    INSERT INTO tournaments (id, name, status)
    SELECT '00000000-0000-0000-0000-000000000001', 'Run It Demo', 'active'
    WHERE NOT EXISTS (SELECT 1 FROM tournaments WHERE id = '00000000-0000-0000-0000-000000000001')
  `);
  await pool.query(`
    INSERT INTO rounds (id, tournament_id, round_number, problem_id, capacity, time_limit_seconds, status, started_at, ends_at)
    SELECT '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001', 1, id, 1, 3600, 'active', now(), now() + interval '1 hour'
    FROM problems WHERE name = 'Hola mundo'
    AND NOT EXISTS (SELECT 1 FROM rounds WHERE id = '00000000-0000-0000-0000-000000000002')
  `);
  await pool.query(`
    INSERT INTO participants (tournament_id, user_id, display_name)
    SELECT '00000000-0000-0000-0000-000000000001', id, username
    FROM users WHERE username = 'demo'
    ON CONFLICT (tournament_id, user_id) DO NOTHING
  `);
  await pool.query(`
    INSERT INTO round_participants (round_id, participant_id)
    SELECT '00000000-0000-0000-0000-000000000002', id
    FROM participants WHERE tournament_id = '00000000-0000-0000-0000-000000000001'
    ON CONFLICT DO NOTHING
  `);
}

module.exports = { pool, query, initDb, withTransaction };
