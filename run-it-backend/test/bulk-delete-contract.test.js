// Borrado masivo de torneos y problemas, y el conteo de /queue/stats. DB-free:
// solo los cortes previos a Postgres (sesión, rol, validación de ids) y los
// criterios SQL que comparten la vista previa y el borrado.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const {
	fastify, sessions, parseIdList, TOURNAMENT_DELETABLE_SQL, PROBLEM_DELETABLE_SQL, INFRA_FAILURE_VERDICTS,
} = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

function sessionFor(role) {
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: `masivo-${role}`, role });
	return { authorization: `Bearer ${token}` };
}

const BULK_ROUTES = [
	['POST', '/tournaments/delete-preview'],
	['DELETE', '/tournaments'],
	['POST', '/problems/delete-preview'],
	['DELETE', '/problems'],
];

test('las rutas de borrado masivo y /queue/stats piden sesión y rol admin', async () => {
	for (const [method, url] of [...BULK_ROUTES, ['GET', '/queue/stats']]) {
		const payload = method === 'GET' ? undefined : { ids: [crypto.randomUUID()] };
		const anonymous = await fastify.inject({ method, url, payload });
		assert.equal(anonymous.statusCode, 401, `${method} ${url} sin sesión`);
		const participant = await fastify.inject({ method, url, headers: sessionFor('participant'), payload });
		assert.equal(participant.statusCode, 403, `${method} ${url} como participante`);
	}
});

test('el borrado masivo rechaza una lista de ids inválida antes de tocar la base', async () => {
	const tooMany = Array.from({ length: 501 }, () => crypto.randomUUID());
	for (const [method, url] of BULK_ROUTES) {
		for (const payload of [{}, { ids: [] }, { ids: 'todos' }, { ids: ['admin'] }, { ids: tooMany }]) {
			const response = await fastify.inject({ method, url, headers: sessionFor('admin'), payload });
			assert.equal(response.statusCode, 400, `${method} ${url} ${JSON.stringify(payload).slice(0, 40)}`);
		}
	}
});

test('parseIdList normaliza y quita repetidos', () => {
	const id = crypto.randomUUID();
	assert.deepEqual(parseIdList([id, id.toUpperCase()]), [id]);
	assert.equal(parseIdList(['1; DELETE FROM users']), null);
	assert.equal(parseIdList(null), null);
});

test('el WHERE del DELETE repite el criterio de la vista previa', () => {
	assert.match(TOURNAMENT_DELETABLE_SQL, /t\.status = 'finished'/);
	assert.match(TOURNAMENT_DELETABLE_SQL, /r\.status <> 'pending'/);
	assert.match(PROBLEM_DELETABLE_SQL, /t\.status <> 'finished'/);
});

test('fallidos son solo errores de infraestructura, no veredictos del programa', () => {
	assert.ok(INFRA_FAILURE_VERDICTS.includes('queue_error'));
	assert.ok(INFRA_FAILURE_VERDICTS.includes('judge_error'));
	for (const verdict of ['Wrong Answer', 'Compilation Error', 'Time Limit Exceeded', 'Runtime Error (NZEC)',
		'round_unavailable', 'no_test_cases', 'accepted', 'queued']) {
		assert.ok(!INFRA_FAILURE_VERDICTS.includes(verdict), verdict);
	}
});

test.after(async () => {
	// Mismo motivo que en rounds-contract: un tick antes de cerrar la cola.
	await new Promise((resolve) => setImmediate(resolve));
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
