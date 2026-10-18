// Vista del caster: reglas de caster.js y contrato de sus endpoints. DB-free:
// las rutas se prueban hasta donde responden sin tocar la base (rol, validación).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const caster = require('../caster');
const hits = require('../hits');
const { fastify, sessions } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

function as(role) {
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: 'contrato', role });
	return { authorization: `Bearer ${token}` };
}

/** El bloque de una ruta en index.js, para revisar su SQL. */
function routeSource(signature) {
	const start = INDEX_SOURCE.indexOf(signature);
	assert.notEqual(start, -1, `falta la ruta ${signature}`);
	const end = INDEX_SOURCE.indexOf('\nfastify.', start + signature.length);
	return INDEX_SOURCE.slice(start, end === -1 ? undefined : end);
}

test('validateCasterName pide entre 3 y 40 caracteres sin contar los espacios del borde', () => {
	assert.deepEqual(caster.validateCasterName('  Leo  '), { name: 'Leo' });
	assert.deepEqual(caster.validateCasterName('x'.repeat(40)), { name: 'x'.repeat(40) });
	for (const bad of ['', '  ab ', 'x'.repeat(41), undefined, 42, null]) {
		assert.match(caster.validateCasterName(bad).error, /entre 3 y 40/);
	}
});

test('el código de un Aceptado se ve recién con la ronda cerrada', () => {
	for (const status of ['pending', 'active', 'closing']) {
		assert.equal(caster.isCodeLocked('accepted', status), true, status);
	}
	assert.equal(caster.isCodeLocked('accepted', 'closed'), false);
	for (const verdict of ['Wrong Answer', 'Time Limit Exceeded', 'Compilation Error', 'Runtime Error (NZEC)']) {
		assert.equal(caster.isCodeLocked(verdict, 'active'), false, verdict);
	}
});

test('publicCases deja solo passed y status: nunca los tokens de Judge0', () => {
	const cases = caster.publicCases([
		{ passed: true, status: 'accepted', token: 'secreto-1' },
		{ passed: false, status: 'Wrong Answer', token: 'secreto-2' },
		{ passed: 0 },
	]);
	assert.deepEqual(cases, [
		{ passed: true, status: 'accepted' },
		{ passed: false, status: 'Wrong Answer' },
		{ passed: false, status: 'rejected' },
	]);
	assert.doesNotMatch(JSON.stringify(cases), /secreto|token/);
	assert.deepEqual(caster.publicCases(null), []);
	assert.deepEqual(caster.publicCases('[]'), []);
});

test('submissionPenalty sigue a penaltyFor y no cobra lo que el worker no cobra', () => {
	const MIN = 60_000;
	const hitRows = [
		{ hit: 'amnistia', startsAt: 10 * MIN, endsAt: 12 * MIN, cancelledAt: null },
		{ hit: 'penal-doble', startsAt: 20 * MIN, endsAt: 22 * MIN, cancelledAt: null },
	];
	const penalty = (verdict, submittedAt, solvedAt = null) =>
		caster.submissionPenalty({ verdict, submittedAt, solvedAt }, hitRows, hits.penaltyFor);
	assert.equal(penalty('Wrong Answer', 5 * MIN), 30);
	assert.equal(penalty('Wrong Answer', 11 * MIN), 0, 'amnistía');
	assert.equal(penalty('Time Limit Exceeded', 21 * MIN), 60, 'penalización doble');
	assert.equal(penalty('Compilation Error', 5 * MIN), 30, 'el worker también cobra el CE');
	for (const verdict of ['accepted', 'queued', 'round_unavailable', 'queue_error', 'judge_error']) {
		assert.equal(penalty(verdict, 5 * MIN), 0, verdict);
	}
	assert.equal(penalty('Wrong Answer', 9 * MIN, 8 * MIN), 0, 'después de resolver no cuenta');
	assert.equal(penalty('Wrong Answer', 7 * MIN, 8 * MIN), 30, 'antes de resolver sí');
});

test('casterSubmissions numera los intentos por participante y no expone el código', () => {
	const at = (minute) => new Date(Date.UTC(2026, 9, 17, 18, minute)).toISOString();
	const row = (id, participant, minute, verdict, solvedMinute = null) => ({
		id,
		participant_id: participant,
		display_name: participant.toUpperCase(),
		character: 3,
		language: 'cpp',
		verdict,
		test_cases_passed: verdict === 'accepted' ? 30 : 12,
		test_cases_total: 30,
		submitted_at: at(minute),
		solved_at: solvedMinute === null ? null : at(solvedMinute),
		code: 'int main() {}',
		case_results: [{ passed: true, status: 'accepted', token: 'x' }],
	});
	// Del más nuevo al más viejo, como lo ordena la ruta.
	const list = caster.casterSubmissions(
		[
			row('s4', 'ana', 9, 'Wrong Answer', 8),
			row('s3', 'ana', 8, 'accepted', 8),
			row('s2', 'beto', 5, 'Compilation Error'),
			row('s1', 'ana', 2, 'Wrong Answer', 8),
		],
		[],
		hits.penaltyFor,
	);
	assert.deepEqual(
		list.map((s) => [s.id, s.attempt, s.penalty_seconds]),
		[
			['s4', 3, 0],
			['s3', 2, 0],
			['s2', 1, 30],
			['s1', 1, 30],
		],
	);
	for (const submission of list) {
		assert.equal('code' in submission, false);
		assert.equal('case_results' in submission, false);
	}
});

test('casterSubmissionDetail oculta el código del Aceptado en curso y limpia los casos', () => {
	const base = {
		id: crypto.randomUUID(),
		round_id: crypto.randomUUID(),
		round_number: 2,
		participant_id: crypto.randomUUID(),
		display_name: 'Misa',
		character: 7,
		language: 'python',
		test_cases_passed: 13,
		test_cases_total: 30,
		submitted_at: new Date().toISOString(),
		attempt: '2',
		code: 'print(1)',
		case_results: [{ passed: false, status: 'Wrong Answer', token: 'secreto' }],
	};
	const wa = caster.casterSubmissionDetail({ ...base, verdict: 'Wrong Answer', round_status: 'active' });
	assert.equal(wa.locked, false);
	assert.equal(wa.code, 'print(1)');
	assert.equal(wa.attempt, 2);
	assert.deepEqual(wa.case_results, [{ passed: false, status: 'Wrong Answer' }]);

	const live = caster.casterSubmissionDetail({ ...base, verdict: 'accepted', round_status: 'active' });
	assert.equal(live.locked, true);
	assert.equal(live.code, null);

	const done = caster.casterSubmissionDetail({ ...base, verdict: 'accepted', round_status: 'closed' });
	assert.equal(done.locked, false);
	assert.equal(done.code, 'print(1)');
	assert.doesNotMatch(JSON.stringify(done), /secreto/);
});

test('las rutas del caster piden sesión de caster o admin', async () => {
	const urls = [
		'/caster/overview',
		`/caster/rounds/${crypto.randomUUID()}/submissions`,
		`/caster/submissions/${crypto.randomUUID()}`,
	];
	for (const url of urls) {
		const anonymous = await fastify.inject({ method: 'GET', url });
		assert.equal(anonymous.statusCode, 401, url);
		const participant = await fastify.inject({ method: 'GET', url, headers: as('participant') });
		assert.equal(participant.statusCode, 403, url);
	}
});

test('las rutas del caster validan el id antes de tocar la base', async () => {
	const headers = as('admin');
	const round = await fastify.inject({ method: 'GET', url: '/caster/rounds/no-es-uuid/submissions', headers });
	assert.equal(round.statusCode, 400);
	const submission = await fastify.inject({ method: 'GET', url: '/caster/submissions/no-es-uuid', headers });
	assert.equal(submission.statusCode, 400);
});

test('solo el admin administra las cuentas de caster', async () => {
	for (const role of ['participant', 'caster']) {
		const headers = as(role);
		assert.equal((await fastify.inject({ method: 'GET', url: '/casters', headers })).statusCode, 403, role);
		const create = await fastify.inject({ method: 'POST', url: '/casters', headers, payload: { username: 'Leo' } });
		assert.equal(create.statusCode, 403, role);
		const remove = await fastify.inject({ method: 'DELETE', url: `/casters/${crypto.randomUUID()}`, headers });
		assert.equal(remove.statusCode, 403, role);
	}
	assert.equal((await fastify.inject({ method: 'GET', url: '/casters' })).statusCode, 401);
});

test('POST /casters y DELETE /casters/:id rechazan datos malos antes de la base', async () => {
	const headers = as('admin');
	const short = await fastify.inject({ method: 'POST', url: '/casters', headers, payload: { username: 'ab' } });
	assert.equal(short.statusCode, 400);
	assert.match(JSON.parse(short.body).error, /entre 3 y 40/);
	const empty = await fastify.inject({ method: 'POST', url: '/casters', headers, payload: {} });
	assert.equal(empty.statusCode, 400);
	const remove = await fastify.inject({ method: 'DELETE', url: '/casters/no-es-uuid', headers });
	assert.equal(remove.statusCode, 400);
});

test('el rol caster existe en la base y solo se borra a sí mismo', () => {
	assert.match(SCHEMA, /ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;/);
	assert.match(SCHEMA, /CHECK \(role IN \('admin', 'participant', 'caster'\)\)/);
	const remove = routeSource("fastify.delete('/casters/:id'");
	assert.match(remove, /DELETE FROM users WHERE id = \$1 AND role = 'caster'/);
	const create = routeSource("fastify.post('/casters'");
	assert.match(create, /VALUES \(\$1, \$2, 'caster'\)/);
	assert.match(create, /'23505'/);
});

test('el SQL del caster no filtra lo que no corresponde', () => {
	const list = routeSource("fastify.get('/caster/rounds/:id/submissions'");
	assert.doesNotMatch(list, /s\.code|case_results/, 'la lista no trae código ni casos');
	assert.match(list, /fogActive/, 'con niebla el caster no ve los envíos');
	const detail = routeSource("fastify.get('/caster/submissions/:id'");
	assert.match(detail, /casterSubmissionDetail/, 'el detalle pasa por la regla del bloqueo');
	const overview = routeSource("fastify.get('/caster/overview'");
	assert.match(overview, /tc->'is_sample' = 'true'::jsonb/, 'de los casos solo salen los ejemplos');
	for (const route of [list, detail, overview]) assert.match(route, /requireCaster/);
	const guard = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf('async function requireCaster'));
	assert.match(guard.slice(0, 900), /SELECT 1 FROM users WHERE id = \$1 AND role = 'caster'/);
});

test('la cuenta fija de caster sale de secrets, como la del admin, sin tocarla', () => {
	const DB_SOURCE = fs.readFileSync(path.join(__dirname, '../db.js'), 'utf8');
	const block = DB_SOURCE.slice(DB_SOURCE.indexOf('process.env.CASTER_ACCESS_CODE'));
	assert.match(block, /VALUES \(\$1, \$2, 'caster'\)/);
	assert.match(block, /ON CONFLICT \(access_code\) DO NOTHING/);
	assert.match(block, /process\.env\.CASTER_USERNAME \|\| 'caster'/);
	// La del admin sigue igual: mismo INSERT y mismo ON CONFLICT.
	assert.match(DB_SOURCE, /ON CONFLICT \(username\) WHERE role = 'admin' DO NOTHING/);
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
