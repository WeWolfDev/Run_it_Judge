// Mantenimiento del admin: filtro de torneos, edición de rondas, borrado de
// problemas y de usuarios huérfanos. DB-free: solo los cortes que ocurren antes
// de tocar Postgres (sesión, rol, validación) y lo que se lee del schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const { fastify, sessions, validateRoundEdit, ORPHAN_USER_SQL } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');

function sessionFor(role) {
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: `mantenimiento-${role}`, role });
	return { authorization: `Bearer ${token}` };
}

const ADMIN_ONLY = [
	['GET', '/tournaments'],
	['GET', '/tournaments?status=finished'],
	['DELETE', `/tournaments/${crypto.randomUUID()}`],
	['PUT', `/rounds/${crypto.randomUUID()}`],
	['DELETE', `/problems/${crypto.randomUUID()}`],
	['GET', '/users/orphans'],
	['DELETE', '/users/orphans'],
];

test('las rutas de mantenimiento piden sesión y rol admin', async () => {
	for (const [method, url] of ADMIN_ONLY) {
		const anonymous = await fastify.inject({ method, url, payload: {} });
		assert.equal(anonymous.statusCode, 401, `${method} ${url} sin sesión`);
		const participant = await fastify.inject({ method, url, headers: sessionFor('participant'), payload: {} });
		assert.equal(participant.statusCode, 403, `${method} ${url} como participante`);
	}
});

test('GET /tournaments solo acepta status=finished como filtro explícito', async () => {
	const response = await fastify.inject({ method: 'GET', url: '/tournaments?status=all', headers: sessionFor('admin') });
	assert.equal(response.statusCode, 400);
});

test('DELETE /users/orphans exige la lista revisada de ids', async () => {
	for (const payload of [{}, { ids: [] }, { ids: ['admin'] }, { ids: 'todos' }]) {
		const response = await fastify.inject({
			method: 'DELETE',
			url: '/users/orphans',
			headers: sessionFor('admin'),
			payload,
		});
		assert.equal(response.statusCode, 400, JSON.stringify(payload));
	}
});

test('el criterio de huérfanos excluye al admin en el propio WHERE', () => {
	assert.match(ORPHAN_USER_SQL, /u\.role = 'participant'/);
	assert.match(ORPHAN_USER_SQL, /NOT EXISTS \(SELECT 1 FROM participants p WHERE p\.user_id = u\.id\)/);
});

test('validateRoundEdit: segundos, cupo positivo y problema con forma de uuid', () => {
	const problemId = crypto.randomUUID();
	assert.equal(validateRoundEdit({ problemId, capacity: 4, timeLimitSeconds: 300 }), null);
	assert.equal(validateRoundEdit({ problemId: null, capacity: null, timeLimitSeconds: 600 }), null);
	// 5 minutos mandados sin convertir llegan como 5 segundos: se rechazan.
	assert.match(validateRoundEdit({ problemId: null, capacity: null, timeLimitSeconds: 5 }), /entre 10 y 86400/);
	assert.match(validateRoundEdit({ problemId: null, capacity: 0, timeLimitSeconds: null }), /entero positivo/);
	assert.match(validateRoundEdit({ problemId: null, capacity: 2.5, timeLimitSeconds: null }), /entero positivo/);
	assert.match(validateRoundEdit({ problemId: 'abc', capacity: null, timeLimitSeconds: null }), /problemId/);
	assert.match(validateRoundEdit({ problemId: null, capacity: null, timeLimitSeconds: null }), /al menos/);
});

test('PUT /rounds/:id valida antes de tocar la base', async () => {
	const response = await fastify.inject({
		method: 'PUT',
		url: `/rounds/${crypto.randomUUID()}`,
		headers: sessionFor('admin'),
		payload: { timeLimitSeconds: 5 },
	});
	assert.equal(response.statusCode, 400);
	assert.match(response.json().error, /entre 10 y 86400/);
});

test('schema: username deja de ser UNIQUE y access_code lo sigue siendo', () => {
	assert.match(schema, /username TEXT NOT NULL,\n/);
	assert.match(schema, /access_code TEXT NOT NULL UNIQUE/);
	assert.match(schema, /CREATE UNIQUE INDEX IF NOT EXISTS users_admin_username_key ON users \(username\) WHERE role = 'admin'/);
});

test('schema: borrar un problema nunca borra rondas', () => {
	assert.match(schema, /problem_id UUID REFERENCES problems\(id\) ON DELETE SET NULL/);
	// Fuera de los comentarios, que sí nombran CASCADE para explicar por qué no.
	const code = schema.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
	assert.doesNotMatch(code, /problem_id[^\n]*CASCADE/);
	assert.doesNotMatch(code, /FOREIGN KEY \(problem_id\)[^\n]*CASCADE/);
});

test('schema: un trigger impide borrar o degradar al admin', () => {
	assert.match(schema, /CREATE OR REPLACE TRIGGER users_protect_admin\s+BEFORE DELETE OR UPDATE OF role ON users/);
});

test.after(async () => {
	// Mismo motivo que en rounds-contract: un tick antes de cerrar la cola.
	await new Promise((resolve) => setImmediate(resolve));
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
