// Contrato de la ceremonia de premios: el cálculo de awards.js con un torneo
// armado a mano, los permisos de los endpoints y las migraciones. DB-free.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const { computeAwards } = require('../awards');
const { fastify, sessions } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

const at = (minute, second = 0) => new Date(Date.UTC(2026, 9, 3, 15, minute, second)).toISOString();
const row = (id, rank, status, extra = {}) => ({
	participant_id: id,
	display_name: id.toUpperCase(),
	character: 0,
	final_rank: rank,
	final_status: status,
	solved_at: null,
	failed_attempts_count: 0,
	...extra,
});
const sub = (id, round, minute, verdict, passed, extra = {}) => ({
	participant_id: id,
	round_number: round,
	submitted_at: at(minute + (round - 1) * 30),
	verdict,
	passed,
	total: 5,
	exec_ms: null,
	...extra,
});

// Ronda 1 (cupo 3): a resuelve primero, b después; d clasifica sin resolver
// tras ir último en la segunda mitad. Ronda 2 (final, cupo 1): e (preclasificado
// 5.º) gana y deja afuera a b, favorito.
function tournament() {
	const rounds = [
		{
			round_number: 1,
			capacity: 3,
			started_at: at(0),
			ended_at: at(10),
			rows: [
				row('a', 1, 'advanced', { solved_at: at(1) }),
				row('b', 2, 'advanced', { solved_at: at(2) }),
				row('d', 3, 'advanced', { failed_attempts_count: 1 }),
				row('c', 4, 'eliminated', { failed_attempts_count: 6 }),
				row('e', 5, 'eliminated'),
			],
		},
		{
			round_number: 2,
			capacity: 1,
			started_at: at(30),
			ended_at: at(40),
			rows: [
				row('a', 1, 'advanced', { solved_at: at(33) }),
				row('d', 2, 'eliminated'),
				row('b', 3, 'eliminated'),
			],
		},
	];
	const submissions = [
		sub('a', 1, 1, 'accepted', 5, { exec_ms: 40 }),
		sub('b', 1, 2, 'accepted', 5, { exec_ms: 12 }),
		sub('c', 1, 6, 'rejected', 4),
		sub('e', 1, 6, 'rejected', 4),
		sub('d', 1, 7, 'rejected', 1),
		sub('d', 1, 9, 'rejected', 4),
		sub('a', 2, 3, 'accepted', 5, { exec_ms: 30 }),
	];
	return { rounds, submissions };
}

test('computeAwards entrega cada premio con su ganador y su dato', () => {
	const { rounds, submissions } = tournament();
	const awards = computeAwards(rounds, submissions);
	const byId = Object.fromEntries(awards.map((award) => [award.id, award]));
	assert.equal(byId.fenix.winner.participant_id, 'd');
	assert.match(byId.fenix.detail, /ronda 1 llegó a ir 5\.º \(cupo 3\)/);
	assert.equal(byId.superviviente.winner.participant_id, 'd');
	assert.equal(byId.verdugo.winner.participant_id, 'a');
	assert.match(byId.verdugo.detail, /2 rondas/);
	assert.equal(byId.rayo.winner.participant_id, 'a');
	assert.match(byId.rayo.detail, /1:00 de la ronda 1/);
	assert.equal(byId.o1.winner.participant_id, 'b');
	assert.match(byId.o1.detail, /12 ms/);
	assert.equal(byId.penalizador.winner.participant_id, 'c');
	assert.match(byId.penalizador.detail, /6 envíos fallidos en la ronda 1, con honor/);
	// El GMA cierra la ceremonia.
	assert.equal(awards.at(-1).id, 'gma');
	assert.equal(awards.at(-1).winner.participant_id, 'a');
});

test('el Matagigantes es la peor preclasificación que dejó afuera a un favorito', () => {
	const { rounds, submissions } = tournament();
	// d (3.º en la ronda 1) no cuenta: es favorito. Se agrega f, preclasificado 6.º.
	rounds[0].rows.push(row('f', 6, 'advanced'));
	rounds[1].rows.splice(1, 0, row('f', 2, 'eliminated'));
	rounds[1].rows.forEach((r, i) => { r.final_rank = i + 1; });
	const giant = computeAwards(rounds, submissions).find((award) => award.id === 'matagigantes');
	assert.equal(giant.winner.participant_id, 'f');
	assert.match(giant.detail, /Preclasificado 6\.º, quedó por encima de B en la ronda 2/);
});

test('sin candidato el premio queda desierto', () => {
	const { rounds, submissions } = tournament();
	const noTimes = submissions.map((s) => ({ ...s, exec_ms: null }));
	const ids = computeAwards(rounds, noTimes).map((award) => award.id);
	assert.ok(!ids.includes('o1'), 'sin tiempos de ejecución no hay Compilador O(1)');
	assert.deepEqual(computeAwards([], []), []);
});

test('los endpoints de la ceremonia exigen admin', async () => {
	const id = crypto.randomUUID();
	for (const [method, url] of [
		['GET', `/tournaments/${id}/ceremony`],
		['POST', `/tournaments/${id}/ceremony/next`],
		['POST', `/tournaments/${id}/ceremony/reset`],
	]) {
		assert.equal((await fastify.inject({ method, url })).statusCode, 401, url);
		const token = crypto.randomUUID();
		sessions.set(token, { id: crypto.randomUUID(), username: 'p', role: 'participant' });
		const forbidden = await fastify.inject({ method, url, headers: { authorization: `Bearer ${token}` } });
		assert.equal(forbidden.statusCode, 403, url);
	}
});

test('migraciones idempotentes para el tiempo de ejecución y la ceremonia', () => {
	assert.match(SCHEMA, /ALTER TABLE submissions ADD COLUMN IF NOT EXISTS exec_ms INTEGER;/);
	assert.match(SCHEMA, /ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ceremony_step INTEGER;/);
	assert.match(SCHEMA, /ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ceremony_updated_at TIMESTAMPTZ;/);
});

test('el worker guarda el mayor tiempo de ejecución y avisa al terminar el torneo', () => {
	assert.match(INDEX_SOURCE, /Math\.round\(Math\.max\(\.\.\.times\) \* 1000\)/);
	assert.match(INDEX_SOURCE, /case_results = \$5::jsonb, exec_ms = \$7/);
	const close = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf('async function closeRound'));
	assert.match(close, /emit\('ceremony:update'/);
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
