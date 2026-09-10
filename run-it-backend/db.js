const { Pool } = require('pg');
const fs = require('node:fs/promises');
const path = require('node:path');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL es obligatorio (ej. postgres://usuario:password@127.0.0.1:5433/judge0)');
}
const pool = new Pool({ connectionString: DATABASE_URL });

const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

async function ensurePostgresBootstrap() {
  const desiredUser = process.env.POSTGRES_USER;
  const desiredPassword = process.env.POSTGRES_PASSWORD;
  const desiredDatabase = process.env.POSTGRES_DB || 'judge0';
  const adminCandidates = [process.env.DATABASE_ADMIN_URL].filter(Boolean);

  if (!adminCandidates.length) return;

  for (const candidate of adminCandidates) {
    const adminPool = new Pool({ connectionString: candidate });
    try {
      await adminPool.query('SELECT 1');
      if (!SAFE_IDENTIFIER.test(desiredUser) || !SAFE_IDENTIFIER.test(desiredDatabase)) {
        throw new Error('POSTGRES_USER o POSTGRES_DB contienen caracteres no permitidos');
      }
      const userExists = await adminPool.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [desiredUser]);
      if (!userExists.rowCount) {
        const quotedPassword = desiredPassword.replace(/'/g, "''");
        await adminPool.query(`CREATE ROLE "${desiredUser}" WITH LOGIN PASSWORD '${quotedPassword}'`);
      }
      const databaseExists = await adminPool.query('SELECT 1 FROM pg_database WHERE datname = $1', [desiredDatabase]);
      if (!databaseExists.rowCount) {
        await adminPool.query(`CREATE DATABASE "${desiredDatabase}" OWNER "${desiredUser}"`);
      }
      await adminPool.query(`GRANT ALL PRIVILEGES ON DATABASE "${desiredDatabase}" TO "${desiredUser}"`);
      return;
    } catch (error) {
      // Try the next admin connection candidate.
    } finally {
      await adminPool.end();
    }
  }
}

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
  await ensurePostgresBootstrap();
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await pool.query(schema);

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  if (process.env.ADMIN_ACCESS_CODE) {
    await pool.query(
      `INSERT INTO users (username, access_code, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (username) DO NOTHING`,
      [adminUsername, process.env.ADMIN_ACCESS_CODE],
    );
  } else {
    console.warn('ADMIN_ACCESS_CODE no definido: no se crea el usuario admin');
  }

  if (process.env.RUN_IT_SEED_DEMO !== 'true') return;

  await pool.query(`
    INSERT INTO users (username, access_code, role)
    VALUES ('demo', 'RUN-IT-2026', 'participant')
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
