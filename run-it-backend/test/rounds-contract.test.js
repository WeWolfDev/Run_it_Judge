// Reglas de rondas y problemas que se pueden comprobar sin base: el motivo de
// bloqueo de /start y los cortes que ocurren antes de tocar Postgres. DB-free:
// corre siempre con npm test.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const { fastify, sessions, describeStartBlock, startBlockReason } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

// Rutas solo de esta prueba, registradas antes del primer inject: simulan el
// error de Postgres sin base.
fastify.get('/__prueba/cast', async () => {
	throw Object.assign(new Error('invalid input syntax for type uuid: "abc"'), { code: '22P02' });
});
fastify.get('/__prueba/falla', async () => {
	throw new Error('falla inesperada');
});

function sessionFor(role) {
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: `contrato-${role}`, role });
	return { authorization: `Bearer ${token}` };
}

test('el motivo de bloqueo nombra la ronda que falta cerrar', () => {
	assert.equal(
		describeStartBlock([{ round_number: 1, status: 'pending' }]),
		'Cerrá la ronda 1 primero: está pendiente',
	);
});

test('una ronda cerrándose bloquea igual que una en curso', () => {
	assert.equal(
		describeStartBlock([{ round_number: 2, status: 'closing' }]),
		'Cerrá la ronda 2 primero: está cerrándose',
	);
	assert.equal(
		describeStartBlock([{ round_number: 2, status: 'active' }]),
		'Cerrá la ronda 2 primero: está en curso',
	);
});

test('con varias rondas abiertas las nombra todas, en orden', () => {
	assert.equal(
		describeStartBlock([
			{ round_number: 3, status: 'active' },
			{ round_number: 1, status: 'pending' },
			{ round_number: 2, status: 'pending' },
		]),
		'Cerrá primero las rondas 1 (pendiente), 2 (pendiente) y 3 (en curso)',
	);
});

test('startBlockReason: torneo terminado, rondas abiertas y ronda siguiente sin roster', () => {
	const base = { round_number: 2, tournament_status: 'active', start_blockers: null, has_previous: true, has_roster: true };
	assert.equal(startBlockReason(base), null);
	assert.equal(startBlockReason({ ...base, has_previous: false, has_roster: false }), null, 'la primera ronda arranca sin roster');
	assert.equal(startBlockReason({ ...base, tournament_status: 'finished' }), 'El torneo ya terminó');
	assert.equal(
		startBlockReason({ ...base, start_blockers: [{ round_number: 1, status: 'closing' }] }),
		'Cerrá la ronda 1 primero: está cerrándose',
	);
	assert.match(startBlockReason({ ...base, has_roster: false }), /^La ronda 2 no tiene participantes/);
});

test('un valor que Postgres no puede convertir es 400, no 500', async () => {
	const response = await fastify.inject({ method: 'GET', url: '/__prueba/cast' });
	assert.equal(response.statusCode, 400);
	assert.deepEqual(response.json(), { error: 'Identificador no válido' });
});

test('cualquier otro error sigue saliendo como el 500 por defecto de Fastify', async () => {
	const response = await fastify.inject({ method: 'GET', url: '/__prueba/falla' });
	assert.equal(response.statusCode, 500);
	assert.deepEqual(response.json(), { statusCode: 500, error: 'Internal Server Error', message: 'falla inesperada' });
});

test('GET /problems/:id/full exige sesión de admin', async () => {
	const url = `/problems/${crypto.randomUUID()}/full`;
	const anonymous = await fastify.inject({ method: 'GET', url });
	assert.equal(anonymous.statusCode, 401);
	const participant = await fastify.inject({ method: 'GET', url, headers: sessionFor('participant') });
	assert.equal(participant.statusCode, 403);
});

test('PUT /problems/:id rechaza dejar el problema sin casos', async () => {
	const response = await fastify.inject({
		method: 'PUT',
		url: `/problems/${crypto.randomUUID()}`,
		headers: sessionFor('admin'),
		payload: { name: 'x', statement: 'y', difficulty: 'easy', testCases: [] },
	});
	assert.equal(response.statusCode, 400);
	assert.match(response.json().error, /entre 1 y 100/);
});

test('PUT /problems/:id rechaza casos que no son texto', async () => {
	const response = await fastify.inject({
		method: 'PUT',
		url: `/problems/${crypto.randomUUID()}`,
		headers: sessionFor('admin'),
		payload: { name: 'x', statement: 'y', testCases: [{ stdin: 'a', expected: 'b', is_sample: true }, { stdin: 1 }] },
	});
	assert.equal(response.statusCode, 400);
	assert.equal(response.json().error, 'El caso 2 debe tener stdin y expected como texto');
});

test.after(async () => {
	// Todo lo de arriba termina en el mismo tick en que la cola empieza a
	// conectarse a Redis (que acá no existe). Cerrarla en ese mismo tick deja el
	// intento de conexión sin dueño y el runner lo reporta como rechazo sin
	// manejar. Un tick de espera basta.
	await new Promise((resolve) => setImmediate(resolve));
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
