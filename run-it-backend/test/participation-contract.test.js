// Contrato de GET /rounds/:id/me: el servidor dice si el participante ya eligió
// personaje en el torneo de la ronda. DB-free: permisos y forma de la consulta.
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

test('GET /rounds/:id/me exige sesión de participante', async () => {
	const url = `/rounds/${crypto.randomUUID()}/me`;
	assert.equal((await fastify.inject({ method: 'GET', url })).statusCode, 401);
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: 'admin', role: 'admin' });
	const forbidden = await fastify.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
	assert.equal(forbidden.statusCode, 403);
});

test('la inscripción se busca por torneo de la ronda y usuario de la sesión', () => {
	const route = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf("fastify.get('/rounds/:id/me'"));
	const body = route.slice(0, route.indexOf('\n});'));
	assert.match(body, /p\.tournament_id = r\.tournament_id AND p\.user_id = \$2/);
	assert.match(body, /\[request\.params\.id, request\.user\.id\]/);
	assert.match(body, /AS has_previous/);
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
