// Contrato de DELETE /access-codes: solo el admin, ids válidos y solo códigos
// sin usar. DB-free: los cortes ocurren antes de tocar Postgres, y el WHERE se
// revisa en el fuente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const { fastify, sessions } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

function sessionFor(role) {
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: `contrato-${role}`, role });
	return { authorization: `Bearer ${token}` };
}

const remove = (headers, payload) => fastify.inject({ method: 'DELETE', url: '/access-codes', headers, payload });

test('DELETE /access-codes exige sesión de admin', async () => {
	const payload = { ids: [crypto.randomUUID()] };
	assert.equal((await remove({}, payload)).statusCode, 401);
	assert.equal((await remove(sessionFor('participant'), payload)).statusCode, 403);
});

test('DELETE /access-codes rechaza una lista de ids no válida', async () => {
	const admin = sessionFor('admin');
	for (const payload of [{}, { ids: [] }, { ids: ['abc'] }, { ids: 'x' }]) {
		const response = await remove(admin, payload);
		assert.equal(response.statusCode, 400, JSON.stringify(payload));
		assert.match(response.json().error, /ids debe ser una lista/);
	}
});

test('solo borra códigos sin usar', () => {
	const route = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf("fastify.delete('/access-codes'"));
	const body = route.slice(0, route.indexOf('\n});'));
	assert.match(body, /DELETE FROM access_codes WHERE id = ANY\(\$1::uuid\[\]\) AND status = 'unused'/);
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
