const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';

const { fastify } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

test('health endpoint reports a live process', async () => {
  const response = await fastify.inject({ method: 'GET', url: '/health' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('protected endpoints reject anonymous requests', async () => {
  const response = await fastify.inject({ method: 'POST', url: '/access-codes/generate', payload: { count: 1 } });

  assert.equal(response.statusCode, 401);
});

test('logout is idempotent without a session', async () => {
  const response = await fastify.inject({ method: 'POST', url: '/auth/logout' });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { loggedOut: true });
});

test.after(async () => {
  await fastify.close();
  await submissionQueue.close();
  await pool.end();
});
