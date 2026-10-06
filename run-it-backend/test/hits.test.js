// Voto del público: reglas de hits.js y contrato de los endpoints. DB-free.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const hits = require('../hits');
const { fastify, sessions, normalizeHint } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

const MIN = 60_000;
const base = (over = {}) => ({
	now: 10 * MIN,
	round: { status: 'active', paused: false, startsAt: 5 * MIN, endsAt: 20 * MIN, capacity: 12 },
	enrolled: 36,
	solved: 0,
	hasHint: true,
	polls: [],
	...over,
});

test('cada par enfrenta un bueno contra un malo', () => {
	for (const pair of hits.PAIRS) {
		assert.equal(hits.HITS[pair.good].kind, 'bueno');
		assert.equal(hits.HITS[pair.bad].kind, 'malo');
	}
});

test('se puede anunciar en la mitad de la ronda', () => {
	assert.equal(hits.pollBlockReason(0, base()), null);
});

test('sin votaciones en el primer minuto ni en los últimos 2 (contando aviso y votación)', () => {
	assert.match(hits.pollBlockReason(0, base({ now: 5 * MIN + 30_000 })), /primer minuto/);
	const endsAt = 20 * MIN;
	const late = endsAt - (hits.QUIET_END_MS + hits.ANNOUNCE_MS + hits.POLL_MS) + 1;
	assert.match(hits.pollBlockReason(0, base({ now: late })), /últimos 2 minutos/);
});

test('máximo 2 votaciones por ronda, una a la vez y sin repetir par', () => {
	const closed = { good: 'extra', bad: 'niebla', status: 'closed' };
	assert.match(hits.pollBlockReason(1, base({ polls: [{ ...closed, status: 'open' }] })), /en curso/);
	assert.match(hits.pollBlockReason(0, base({ polls: [closed] })), /ya se usó/);
	assert.match(hits.pollBlockReason(2, base({ polls: [closed, { good: 'amnistia', bad: 'penal-doble', status: 'closed' }] })), /2 votaciones/);
	// Una cancelada no cuenta.
	assert.equal(hits.pollBlockReason(0, base({ polls: [{ ...closed, status: 'cancelled' }] })), null);
});

test('los cupos no se tocan con cupo chico ni con el cupo casi lleno', () => {
	assert.match(hits.pollBlockReason(2, base({ round: { ...base().round, capacity: 2 } })), /cupo 2/);
	assert.match(hits.pollBlockReason(2, base({ solved: 11 })), /casi se llenó/);
	assert.match(hits.pollBlockReason(2, base({ enrolled: 13 })), /pasarían todos/);
});

test('la pista del organizador necesita una pista cargada', () => {
	assert.match(hits.pollBlockReason(3, base({ hasHint: false })), /no tiene pista/);
});

test('el empate se sortea y si no gana el más votado', () => {
	const pair = hits.PAIRS[0];
	assert.equal(hits.pickWinner(pair, { good: 3, bad: 5 }), 'niebla');
	assert.equal(hits.pickWinner(pair, { good: 5, bad: 3 }), 'extra');
	assert.equal(hits.pickWinner(pair, { good: 2, bad: 2 }, () => 0.1), 'extra');
	assert.equal(hits.pickWinner(pair, { good: 2, bad: 2 }, () => 0.9), 'niebla');
});

test('la penalización depende del hit activo cuando se envió', () => {
	const list = [
		{ hit: 'amnistia', startsAt: 100, endsAt: 200, cancelledAt: null },
		{ hit: 'penal-doble', startsAt: 300, endsAt: 400, cancelledAt: null },
		{ hit: 'penal-doble', startsAt: 500, endsAt: 600, cancelledAt: 550 },
	];
	assert.equal(hits.penaltyFor(list, 150), 0);
	assert.equal(hits.penaltyFor(list, 350), 60);
	assert.equal(hits.penaltyFor(list, 250), 30);
	assert.equal(hits.penaltyFor(list, 580), 30);
});

test('la pista del problema es opcional y corta', () => {
	assert.equal(normalizeHint(undefined), null);
	assert.equal(normalizeHint('   '), null);
	assert.equal(normalizeHint(' usa long long '), 'usa long long');
	assert.equal(normalizeHint('x'.repeat(501)), false);
});

test('el panel del voto exige admin', async () => {
	const id = crypto.randomUUID();
	for (const [method, url] of [
		['GET', `/rounds/${id}/hits`],
		['POST', `/rounds/${id}/hits/polls`],
		['POST', `/hits/polls/${id}/cancel`],
		['POST', `/hits/polls/${id}/close`],
		['POST', `/round-hits/${id}/cancel`],
	]) {
		assert.equal((await fastify.inject({ method, url })).statusCode, 401, url);
		const token = crypto.randomUUID();
		sessions.set(token, { id: crypto.randomUUID(), username: 'p', role: 'participant' });
		const forbidden = await fastify.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
		assert.equal(forbidden.statusCode, 403, url);
	}
});

test('votar pide un votante válido y deja fuera a quien tiene sesión', async () => {
	const pollId = crypto.randomUUID();
	const bad = await fastify.inject({ method: 'POST', url: '/public/hits/vote', payload: { pollId, choice: 'good' } });
	assert.equal(bad.statusCode, 400);
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: 'p', role: 'participant' });
	const participant = await fastify.inject({
		method: 'POST',
		url: '/public/hits/vote',
		payload: { pollId, choice: 'good' },
		headers: { authorization: `Bearer ${token}`, 'x-voter': 'a'.repeat(24) },
	});
	assert.equal(participant.statusCode, 403);
});

test('migraciones del voto idempotentes y con borrado en cascada', () => {
	for (const table of ['hit_polls', 'hit_votes', 'round_hits']) {
		assert.match(SCHEMA, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
	}
	assert.match(SCHEMA, /PRIMARY KEY \(poll_id, voter\)/);
	assert.match(SCHEMA, /ALTER TABLE problems ADD COLUMN IF NOT EXISTS hint TEXT;/);
	assert.equal((SCHEMA.match(/REFERENCES rounds\(id\) ON DELETE CASCADE/g) || []).length >= 2, true);
});

test('la ronda al cerrarse termina el voto y la niebla oculta el ranking', () => {
	const close = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf('async function closeRound'));
	assert.match(close, /UPDATE hit_polls SET status = 'cancelled' WHERE round_id = \$1 AND status = 'open'/);
	const board = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf("fastify.get('/rounds/:id/leaderboard'"));
	assert.match(board.slice(0, 500), /fogActive/);
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
