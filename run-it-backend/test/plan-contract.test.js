// Contrato del plan de rondas (PUT /tournaments/:id/plan), la dificultad de las
// rondas, los códigos de acceso visibles y la cantidad de personajes. DB-free.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const { fastify, sessions, validateRoundPlan, validateRoundEdit, CHARACTER_COUNT } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
const FRONTEND = (file) => fs.readFileSync(path.join(__dirname, '../../frontend/src', file), 'utf8');

const problemId = crypto.randomUUID();
const round = (n, extra = {}) => ({
	round_number: n,
	difficulty: 'easy',
	problemId,
	capacity: 4,
	timeLimitSeconds: 600,
	...extra,
});

function planAs(role, rounds) {
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: 'contrato', role });
	return fastify.inject({
		method: 'PUT',
		url: `/tournaments/${crypto.randomUUID()}/plan`,
		headers: { authorization: `Bearer ${token}` },
		payload: { rounds },
	});
}

test('validateRoundPlan acepta un plan de varias rondas', () => {
	assert.equal(validateRoundPlan([round(1), round(2, { difficulty: 'medium' }), round(3, { difficulty: 'hard' })]), null);
});

test('validateRoundPlan rechaza planes vacíos, números repetidos y datos inválidos', () => {
	assert.match(validateRoundPlan([]), /no tiene rondas/);
	assert.match(validateRoundPlan(undefined), /no tiene rondas/);
	assert.match(validateRoundPlan([round(1), round(1)]), /repetida/);
	assert.match(validateRoundPlan([round(0)]), /entero desde 1/);
	assert.match(validateRoundPlan([round(1, { difficulty: 'extrema' })]), /difficulty/);
	assert.match(validateRoundPlan([round(1, { problemId: '' })]), /problema/);
	assert.match(validateRoundPlan([round(1, { capacity: 0 })]), /cupo/);
	assert.match(validateRoundPlan([round(1, { timeLimitSeconds: 5 })]), /tiempo/);
});

test('PUT /tournaments/:id/plan exige admin y valida antes de tocar la base', async () => {
	const anonymous = await fastify.inject({ method: 'PUT', url: `/tournaments/${crypto.randomUUID()}/plan`, payload: {} });
	assert.equal(anonymous.statusCode, 401);
	assert.equal((await planAs('participant', [round(1)])).statusCode, 403);
	const invalid = await planAs('admin', [round(1), round(1)]);
	assert.equal(invalid.statusCode, 400);
	assert.match(JSON.parse(invalid.body).error, /repetida/);
});

test('PUT /rounds/:id acepta la dificultad sola y rechaza valores desconocidos', () => {
	assert.equal(validateRoundEdit({ problemId: null, capacity: null, timeLimitSeconds: null, difficulty: 'hard' }), null);
	assert.match(validateRoundEdit({ problemId: null, capacity: null, timeLimitSeconds: null, difficulty: 'x' }), /difficulty/);
	// Sin dificultad sigue funcionando como antes.
	assert.equal(validateRoundEdit({ problemId: null, capacity: 3, timeLimitSeconds: null }), null);
});

test('la columna difficulty se agrega de forma idempotente y con sus valores válidos', () => {
	assert.match(SCHEMA, /ALTER TABLE rounds ADD COLUMN IF NOT EXISTS difficulty TEXT;/);
	assert.match(SCHEMA, /difficulty IS NULL OR difficulty IN \('easy', 'medium', 'hard'\)/);
});

test('GET /access-codes no lista los invalidados ni los vencidos sin usar', () => {
	const start = INDEX_SOURCE.indexOf("fastify.get('/access-codes'");
	const route = INDEX_SOURCE.slice(start, INDEX_SOURCE.indexOf('fastify.post', start));
	assert.match(route, /ac\.status <> 'expired'/);
	assert.match(route, /ac\.status = 'unused' AND ac\.expires_at IS NOT NULL AND ac\.expires_at <= now\(\)/);
});

test('avanzar llena la ronda siguiente planificada en vez de rechazarla', () => {
	assert.match(INDEX_SOURCE, /const planned = existing\.rowCount && existing\.rows\[0\]\.status === 'pending' && existing\.rows\[0\]\.enrolled === 0;/);
	assert.match(INDEX_SOURCE, /if \(existing\.rowCount && !planned\)/);
});

test('backend y frontend tienen la misma cantidad de personajes', () => {
	const session = FRONTEND('lib/session.ts').match(/export const CHARACTER_COUNT = (\d+);/);
	assert.ok(session, 'No se encontró CHARACTER_COUNT en session.ts');
	assert.equal(Number(session[1]), CHARACTER_COUNT);
	// characters.ts arma la lista con grupos; se cuentan las entradas de cada uno.
	const characters = FRONTEND('lib/characters.ts');
	const named = (characters.match(/^\s+\["[^"]+", "[^"]+", /gm) || []).length;
	const npcs = (characters.match(/const npcNames = \[([^\]]+)\]/)?.[1].match(/"/g) || []).length / 2;
	const others = (characters.match(/^\s+name: "/gm) || []).length;
	assert.equal(named + npcs + others, CHARACTER_COUNT, 'characters.ts no tiene CHARACTER_COUNT personajes');
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
