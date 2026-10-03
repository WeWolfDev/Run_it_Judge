// Transición entre rondas, continuidad y edición de problemas contra el backend
// de desarrollo (deploy/dev-branch.sh up, :5000) y run_it_dev. No usa Judge0:
// el ranking de cierre sale de POST /rounds/:id/close sin envíos.
//
// Se saltea por defecto. Para correrla:
//   RUN_IT_ROUNDS_E2E=1 node --test test/rounds.e2e.test.js
//
// Algunos estados no se pueden armar por la API a propósito (una ronda 2
// pendiente con la 1 abierta, una ronda en 'closing'): se escriben con SQL en
// run_it_dev, como quedarían los datos creados antes de estas reglas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const enabled = process.env.RUN_IT_ROUNDS_E2E === '1';
const skip = enabled ? false : 'RUN_IT_ROUNDS_E2E=1 para correr contra el backend de desarrollo';

const API_URL = process.env.RUN_IT_E2E_API_URL || 'http://127.0.0.1:5000';
const DB_NAME = process.env.RUN_IT_E2E_DB_NAME || 'run_it_dev';
const ADMIN_USERNAME = process.env.RUN_IT_DEV_ADMIN_USERNAME || 'devadmin';
const ADMIN_ACCESS_CODE = process.env.RUN_IT_DEV_ADMIN_ACCESS_CODE || 'dev-admin-dev';

function databaseUrl() {
	if (process.env.RUN_IT_E2E_DATABASE_URL) return process.env.RUN_IT_E2E_DATABASE_URL;
	const stateDir = process.env.RUN_IT_DEV_STATE_DIR || '/tmp/run-it-dev';
	const env = fs.readFileSync(path.join(stateDir, 'dev.env'), 'utf8');
	const password = env.match(/^RUN_IT_DEV_DB_PASSWORD=(.+)$/m)?.[1];
	assert.ok(password, `No hay RUN_IT_DEV_DB_PASSWORD en ${stateDir}/dev.env`);
	return `postgres://run_it_dev:${encodeURIComponent(password)}@127.0.0.1:5433/${DB_NAME}`;
}

// Nunca contra producción: ni la base run_it ni el backend de :3001.
function assertDevelopmentTargets(url) {
	assert.notEqual(new URL(url).pathname.slice(1), 'run_it', 'La base run_it es la de producción');
	assert.notEqual(new URL(API_URL).port, '3001', ':3001 es el backend de producción');
}

const state = { nonce: crypto.randomBytes(3).toString('hex'), rounds: [] };

async function api(method, url, body, token) {
	const response = await fetch(`${API_URL}${url}`, {
		method,
		headers: {
			...(body === undefined ? {} : { 'content-type': 'application/json' }),
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function ok(method, url, body, token) {
	const response = await api(method, url, body, token);
	assert.ok(response.status < 300, `${method} ${url} -> ${response.status}: ${JSON.stringify(response.body)}`);
	return response.body;
}

async function createProblem(label, testCases) {
	return ok('POST', '/problems', {
		name: `e2e rondas ${state.nonce} ${label}`,
		statement: `Enunciado de ${label}`,
		testCases,
	}, state.adminToken);
}

async function createTournamentWithRound(label, problemId, capacity) {
	const tournament = await ok('POST', '/tournaments', { name: `e2e rondas ${state.nonce} ${label}` }, state.adminToken);
	const round = await ok('POST', '/rounds', {
		tournamentId: tournament.id, roundNumber: 1, problemId, capacity, timeLimitSeconds: 600,
	}, state.adminToken);
	state.rounds.push(round.id);
	return { tournament, round };
}

async function register(tournamentId, labels) {
	const { codes } = await ok('POST', '/access-codes/generate', { count: labels.length, tournamentId }, state.adminToken);
	const users = {};
	for (const [index, label] of labels.entries()) {
		const { token, user } = await ok('POST', '/auth/register', {
			username: `e2e-${label}-${state.nonce}`, accessCode: codes[index].code,
		});
		users[label] = { token, id: user.id };
	}
	return users;
}

const join = (roundId, user) => api('POST', `/rounds/${roundId}/participants/join`, { character: 2 }, user.token);

async function roster(roundId) {
	const { rows } = await state.db.query(
		`SELECT p.user_id FROM round_participants rp JOIN participants p ON p.id = rp.participant_id
		 WHERE rp.round_id = $1 ORDER BY p.user_id`,
		[roundId],
	);
	return rows.map((row) => row.user_id);
}

// Pide el snapshot de una ronda por el socket, con la sesión del usuario.
async function socketSnapshot(user, roundId) {
	const socket = state.io(API_URL, { auth: { token: user.token }, transports: ['websocket'], reconnection: false });
	try {
		await new Promise((resolve, reject) => {
			socket.once('connect', resolve);
			socket.once('connect_error', reject);
		});
		const snapshot = new Promise((resolve) => socket.once('round:snapshot', resolve));
		socket.emit('round:join', roundId);
		socket.emit('round:snapshot', roundId);
		return await snapshot;
	} finally {
		socket.close();
	}
}

// Inserta una ronda sin pasar por la API, como las que creaba el panel antes de
// que POST /rounds aceptara solo la primera.
async function insertLegacyRound(tournamentId, roundNumber, problemId) {
	const { rows } = await state.db.query(
		`INSERT INTO rounds (tournament_id, round_number, problem_id, capacity, time_limit_seconds)
		 VALUES ($1, $2, $3, 1, 600) RETURNING id`,
		[tournamentId, roundNumber, problemId],
	);
	state.rounds.push(rows[0].id);
	return rows[0].id;
}

const setStatus = (roundId, status) => state.db.query('UPDATE rounds SET status = $2 WHERE id = $1', [roundId, status]);

test('preparación: admin, base run_it_dev y socket', { skip }, async () => {
	const url = databaseUrl();
	assertDevelopmentTargets(url);
	const { Pool } = require('pg');
	state.db = new Pool({ connectionString: url, max: 2 });
	const { rows } = await state.db.query('SELECT current_database() AS name');
	assert.equal(rows[0].name, DB_NAME);
	const frontendRequire = createRequire(path.join(__dirname, '../../frontend/package.json'));
	state.io = frontendRequire('socket.io-client').io;
	state.adminToken = (await ok('POST', '/auth/login', { username: ADMIN_USERNAME, accessCode: ADMIN_ACCESS_CODE })).token;
	state.problem = await createProblem('base', [{ stdin: 'a', expected: 'a', is_sample: true }]);
});

test('POST /rounds solo crea la primera ronda de un torneo', { skip }, async (t) => {
	const { tournament } = await createTournamentWithRound('primera', state.problem.id, 1);
	const second = await api('POST', '/rounds', {
		tournamentId: tournament.id, roundNumber: 2, problemId: state.problem.id, capacity: 1, timeLimitSeconds: 600,
	}, state.adminToken);
	t.diagnostic(`POST /rounds ronda 2 -> ${second.status} ${second.body.error}`);
	assert.equal(second.status, 409);
	assert.match(second.body.error, /ya tiene la ronda 1/);
});

test('la ronda siguiente tiene exactamente a los clasificados y solo ellos entran', { skip }, async (t) => {
	const { tournament, round } = await createTournamentWithRound('roster', state.problem.id, 2);
	const users = await register(tournament.id, ['ana', 'beto', 'caro']);
	for (const user of Object.values(users)) assert.equal((await join(round.id, user)).status, 200);
	await ok('POST', `/rounds/${round.id}/start`, {}, state.adminToken);
	await ok('POST', `/rounds/${round.id}/close`, {}, state.adminToken);

	const { rows: finals } = await state.db.query(
		`SELECT p.user_id, rp.final_status FROM round_participants rp JOIN participants p ON p.id = rp.participant_id
		 WHERE rp.round_id = $1`,
		[round.id],
	);
	const advanced = finals.filter((row) => row.final_status === 'advanced').map((row) => row.user_id).sort();
	const eliminatedId = finals.find((row) => row.final_status === 'eliminated').user_id;
	const byId = Object.fromEntries(Object.values(users).map((user) => [user.id, user]));
	assert.equal(advanced.length, 2);

	const next = await ok('POST', `/rounds/${round.id}/next`, { problemId: state.problem.id, timeLimitSeconds: 600 }, state.adminToken);
	state.rounds.push(next.round.id);
	state.rosterRound = next.round.id;
	assert.deepEqual(await roster(next.round.id), advanced);

	const eliminated = await join(next.round.id, byId[eliminatedId]);
	t.diagnostic(`eliminado -> ${eliminated.status} ${eliminated.body.error}`);
	assert.equal(eliminated.status, 403);
	assert.match(eliminated.body.error, /No estás en la ronda 2/);

	// Del torneo pero nunca jugó la ronda 1: participants.status sigue 'active'.
	// Con la guarda vieja entraba; el rechazo solo puede venir del roster.
	const late = (await register(tournament.id, ['dani'])).dani;
	const lateJoin = await join(next.round.id, late);
	t.diagnostic(`nunca jugó la ronda 1 -> ${lateJoin.status} ${lateJoin.body.error}`);
	assert.equal(lateJoin.status, 403);
	assert.deepEqual(await roster(next.round.id), advanced, 'un rechazado quedó en el roster');

	// Iniciar no toca el roster.
	await ok('POST', `/rounds/${next.round.id}/start`, {}, state.adminToken);
	assert.deepEqual(await roster(next.round.id), advanced, 'iniciar cambió el roster');

	for (const userId of advanced) {
		const joined = await join(next.round.id, byId[userId]);
		assert.equal(joined.status, 200);
		assert.equal(joined.body.character, 2);
		const snapshot = await socketSnapshot(byId[userId], next.round.id);
		assert.equal(snapshot?.id, next.round.id, 'un clasificado no recibe el snapshot');
	}
	assert.equal(await socketSnapshot(byId[eliminatedId], next.round.id), null, 'el eliminado lee la ronda por el socket');
	assert.equal(await socketSnapshot(late, next.round.id), null, 'alguien fuera del roster lee la ronda por el socket');

	const pista = await ok('GET', '/public/rounds/active');
	if (pista.id === next.round.id) {
		assert.equal(pista.participants.length, 2);
		t.diagnostic(`pista: ${pista.participants.map((p) => `${p.name} (personaje ${p.character})`).join(', ')}`);
	}
	await ok('POST', `/rounds/${next.round.id}/close`, {}, state.adminToken);
});

test('una ronda no inicia con una anterior sin cerrar, y el motivo es el mismo del listado', { skip }, async (t) => {
	// Cupo 2 con dos inscriptos: al cerrar la 1 no hay ganador y el torneo sigue.
	const { tournament, round: first } = await createTournamentWithRound('continuidad', state.problem.id, 2);
	const second = await insertLegacyRound(tournament.id, 2, state.problem.id);
	// Con inscriptos en la 2, así lo único que la frena es la ronda 1.
	for (const user of Object.values(await register(tournament.id, ['eve', 'fede']))) {
		const joined = await join(first.id, user);
		await state.db.query('INSERT INTO round_participants (round_id, participant_id) VALUES ($1, $2)', [second, joined.body.id]);
	}

	for (const status of ['pending', 'active', 'closing']) {
		await setStatus(first.id, status);
		const refused = await api('POST', `/rounds/${second}/start`, undefined, state.adminToken);
		t.diagnostic(`ronda 1 ${status} -> ${refused.status} ${refused.body.error}`);
		assert.equal(refused.status, 409);
		assert.match(refused.body.error, /Cerrá la ronda 1 primero/);
		const listed = await ok('GET', `/tournaments/${tournament.id}/rounds`, undefined, state.adminToken);
		assert.equal(listed.find((row) => row.id === second).start_blocked_reason, refused.body.error);
		assert.equal(listed.find((row) => row.id === first.id).start_blocked_reason, null);
		const { rows } = await state.db.query('SELECT status FROM rounds WHERE id = $1', [second]);
		assert.equal(rows[0].status, 'pending');
	}

	await setStatus(first.id, 'active');
	await ok('POST', `/rounds/${first.id}/close`, {}, state.adminToken);
	const started = await api('POST', `/rounds/${second}/start`, undefined, state.adminToken);
	t.diagnostic(`ronda 1 cerrada -> ${started.status} ${started.body.status ?? started.body.error}`);
	assert.equal(started.status, 200);
	assert.equal(started.body.status, 'active');
});

test('no inicia una ronda de un torneo terminado ni una siguiente sin roster', { skip }, async (t) => {
	// Ronda 2 sin roster, como las que dejó el panel viejo con POST /rounds.
	const { tournament, round: first } = await createTournamentWithRound('sin roster', state.problem.id, 1);
	const orphan = await insertLegacyRound(tournament.id, 2, state.problem.id);
	await ok('POST', `/rounds/${first.id}/start`, {}, state.adminToken);
	await ok('POST', `/rounds/${first.id}/close`, {}, state.adminToken);
	const empty = await api('POST', `/rounds/${orphan}/start`, undefined, state.adminToken);
	t.diagnostic(`ronda 2 sin roster -> ${empty.status} ${empty.body.error}`);
	assert.equal(empty.status, 409);
	assert.match(empty.body.error, /no tiene participantes/);
	const listed = await ok('GET', `/tournaments/${tournament.id}/rounds`, undefined, state.adminToken);
	assert.equal(listed.find((row) => row.id === orphan).start_blocked_reason, empty.body.error);
	// La salida que ofrece el panel: borrarla (sigue pendiente).
	await ok('DELETE', `/rounds/${orphan}`, undefined, state.adminToken);

	const { tournament: done, round: leftover } = await createTournamentWithRound('terminado', state.problem.id, 1);
	await ok('POST', `/tournaments/${done.id}/finish`, {}, state.adminToken);
	const finished = await api('POST', `/rounds/${leftover.id}/start`, undefined, state.adminToken);
	t.diagnostic(`ronda de un torneo terminado -> ${finished.status} ${finished.body.error}`);
	assert.equal(finished.status, 409);
	assert.equal(finished.body.error, 'El torneo ya terminó');
	const { rows } = await state.db.query('SELECT status FROM rounds WHERE id = $1', [leftover.id]);
	assert.equal(rows[0].status, 'pending');
	// Tampoco se puede inscribir nadie en esa ronda que no se va a jugar. Los
	// códigos del torneo murieron con él: se usa uno global.
	const { codes } = await ok('POST', '/access-codes/generate', { count: 1, ttlMinutes: 5 }, state.adminToken);
	const { token } = await ok('POST', '/auth/register', { username: `e2e-tarde-${state.nonce}`, accessCode: codes[0].code });
	const lateJoin = await api('POST', `/rounds/${leftover.id}/participants/join`, { character: 1 }, token);
	t.diagnostic(`inscribirse en un torneo terminado -> ${lateJoin.status} ${lateJoin.body.error}`);
	assert.equal(lateJoin.status, 409);
	assert.equal(lateJoin.body.error, 'El torneo ya terminó');
});

test('un id que no es UUID da 400, no 500', { skip }, async (t) => {
	for (const [method, url] of [
		['POST', '/rounds/abc/start'],
		['GET', '/rounds/abc/leaderboard'],
		['PUT', '/rounds/abc'],
		['DELETE', '/problems/abc'],
		['GET', '/tournaments/abc/rounds'],
	]) {
		const response = await api(method, url, method === 'PUT' ? { capacity: 2 } : undefined, state.adminToken);
		t.diagnostic(`${method} ${url} -> ${response.status} ${JSON.stringify(response.body)}`);
		assert.equal(response.status, 400);
		assert.equal(response.body.error, 'Identificador no válido');
	}
});

test('iniciar la ronda 1 y la 2 a la vez: solo arranca la 1', { skip }, async () => {
	const { tournament, round: first } = await createTournamentWithRound('carrera', state.problem.id, 1);
	const second = await insertLegacyRound(tournament.id, 2, state.problem.id);
	const [a, b] = await Promise.all([
		api('POST', `/rounds/${first.id}/start`, undefined, state.adminToken),
		api('POST', `/rounds/${second}/start`, undefined, state.adminToken),
	]);
	assert.equal(a.status, 200);
	assert.equal(b.status, 409);
});

test('la ronda 1 de un torneo nuevo inicia, y dos clics simultáneos la inician una sola vez', { skip }, async (t) => {
	const { round } = await createTournamentWithRound('doble clic', state.problem.id, 1);
	const responses = await Promise.all(
		Array.from({ length: 8 }, () => api('POST', `/rounds/${round.id}/start`, undefined, state.adminToken)),
	);
	const statuses = responses.map((response) => response.status);
	t.diagnostic(`8 POST /start simultáneos -> ${statuses.join(' ')}`);
	assert.equal(statuses.filter((status) => status === 200).length, 1);
	assert.equal(statuses.filter((status) => status === 409).length, 7);
	assert.match(responses.find((r) => r.status === 409).body.error, /La ronda 1 no está pendiente: está en curso/);
});

test('GET /problems/:id/full devuelve is_sample y GET /problems/:id sigue sin casos', { skip }, async () => {
	const problem = await createProblem('full', [
		{ stdin: '1', expected: '1', is_sample: true },
		{ stdin: '2', expected: '2', is_sample: false },
	]);
	const full = await ok('GET', `/problems/${problem.id}/full`, undefined, state.adminToken);
	assert.deepEqual(full.test_cases.map((tc) => tc.is_sample), [true, false]);
	assert.deepEqual(full.rounds, []);
	const open = await ok('GET', `/problems/${problem.id}`);
	assert.equal(open.test_cases, undefined);
	assert.equal(open.statement, undefined);
});

test('editar casos con la ronda en juego se rechaza; el enunciado no', { skip }, async (t) => {
	const cases = [
		{ stdin: '1', expected: '1', is_sample: true },
		{ stdin: '2', expected: '2', is_sample: false },
		{ stdin: '3', expected: '3', is_sample: false },
	];
	const problem = await createProblem('edicion', cases);
	const { round } = await createTournamentWithRound('edicion', problem.id, 1);
	await ok('POST', `/rounds/${round.id}/start`, {}, state.adminToken);
	const body = (overrides) => ({ name: problem.name, statement: 'Enunciado sin typo', difficulty: 'easy', testCases: cases, ...overrides });

	const statementOnly = await api('PUT', `/problems/${problem.id}`, body({}), state.adminToken);
	assert.equal(statementOnly.status, 200);
	assert.equal(statementOnly.body.statement, 'Enunciado sin typo');
	assert.deepEqual(statementOnly.body.test_cases.map((tc) => tc.is_sample), [true, false, false]);

	const changed = cases.map((tc, index) => (index === 2 ? { ...tc, expected: '33' } : tc));
	for (const status of ['active', 'closing']) {
		await setStatus(round.id, status);
		const refused = await api('PUT', `/problems/${problem.id}`, body({ testCases: changed }), state.adminToken);
		t.diagnostic(`casos con la ronda ${status} -> ${refused.status} ${refused.body.error}`);
		assert.equal(refused.status, 409);
		assert.match(refused.body.error, /la ronda 1 de "e2e rondas .* edicion"/);
	}
	// Desmarcar un ejemplo también es cambiar los casos: cambia lo que ve el participante.
	const unmarked = await api('PUT', `/problems/${problem.id}`, body({ testCases: cases.map((tc) => ({ ...tc, is_sample: false })) }), state.adminToken);
	assert.equal(unmarked.status, 409);
	const stored = await ok('GET', `/problems/${problem.id}/full`, undefined, state.adminToken);
	assert.deepEqual(stored.test_cases, cases, 'un PUT rechazado tocó los casos');

	await setStatus(round.id, 'active');
	await ok('POST', `/rounds/${round.id}/close`, {}, state.adminToken);
	const accepted = await api('PUT', `/problems/${problem.id}`, body({ testCases: changed }), state.adminToken);
	assert.equal(accepted.status, 200);
	assert.equal(accepted.body.test_cases[2].expected, '33');
});

test('/public/rounds/active publica solo los ejemplos, proyectados', { skip }, async (t) => {
	const problem = await createProblem('ejemplos', [
		{ stdin: 's1', expected: 'e1', is_sample: true },
		{ stdin: 'p1', expected: 'x1', is_sample: false },
		{ stdin: 's2', expected: 'e2', is_sample: true },
		{ stdin: 'p2', expected: 'x2', is_sample: false },
		{ stdin: 'p3', expected: 'x3', is_sample: false },
	]);
	const { round } = await createTournamentWithRound('ejemplos', problem.id, 1);
	await ok('POST', `/rounds/${round.id}/start`, {}, state.adminToken);
	const active = await ok('GET', '/public/rounds/active');
	assert.equal(active.id, round.id);
	t.diagnostic(`samples: ${JSON.stringify(active.samples)}`);
	assert.deepEqual(active.samples, [{ stdin: 's1', expected: 'e1' }, { stdin: 's2', expected: 'e2' }]);
	assert.equal(active.test_cases, undefined);
	await ok('POST', `/rounds/${round.id}/close`, {}, state.adminToken);
});

test('borrar un problema: libre, en uso por una pendiente, por una jugada y con el torneo terminado', { skip }, async (t) => {
	const unused = await createProblem('sin uso', [{ stdin: 'a', expected: 'a', is_sample: false }]);
	await ok('DELETE', `/problems/${unused.id}`, undefined, state.adminToken);
	const listed = await ok('GET', '/problems');
	assert.equal(listed.some((problem) => problem.id === unused.id), false);

	const pending = await createProblem('pendiente', [{ stdin: 'a', expected: 'a', is_sample: false }]);
	const { round } = await createTournamentWithRound('borrado', pending.id, 1);
	const full = await ok('GET', `/problems/${pending.id}/full`, undefined, state.adminToken);
	assert.deepEqual(full.rounds.map((r) => [r.round_number, r.status]), [[1, 'pending']]);
	const inUse = await api('DELETE', `/problems/${pending.id}`, undefined, state.adminToken);
	t.diagnostic(`problema en uso -> ${inUse.status} ${inUse.body.error}`);
	assert.equal(inUse.status, 409);
	// El 409 nombra la ronda y el torneo que lo bloquean.
	assert.match(inUse.body.error, /^No se puede borrar: lo usa ronda 1 de "e2e rondas \S+ borrado" \(pendiente\)/);
	await ok('DELETE', `/rounds/${round.id}`, undefined, state.adminToken);
	await ok('DELETE', `/problems/${pending.id}`, undefined, state.adminToken);

	const played = await createProblem('jugado', [{ stdin: 'a', expected: 'a', is_sample: false }]);
	const { tournament: playedTournament, round: closed } = await createTournamentWithRound('jugado', played.id, 1);
	await ok('POST', `/rounds/${closed.id}/start`, {}, state.adminToken);
	await ok('POST', `/rounds/${closed.id}/close`, {}, state.adminToken);
	const closedDelete = await api('DELETE', `/rounds/${closed.id}`, undefined, state.adminToken);
	t.diagnostic(`borrar ronda cerrada -> ${closedDelete.status} ${closedDelete.body.error}`);
	assert.equal(closedDelete.status, 409);
	assert.equal((await api('DELETE', `/problems/${played.id}`, undefined, state.adminToken)).status, 409);

	// Con el torneo terminado se borra, y la ronda sobrevive con el nombre.
	await ok('POST', `/tournaments/${playedTournament.id}/finish`, {}, state.adminToken);
	const deleted = await ok('DELETE', `/problems/${played.id}`, undefined, state.adminToken);
	assert.equal(deleted.roundsKept, 1);
	const kept = await ok('GET', `/tournaments/${playedTournament.id}/rounds`, undefined, state.adminToken);
	assert.deepEqual(
		kept.map((r) => [r.round_number, r.status, r.problem_id, r.problem_name]),
		[[1, 'closed', null, played.name]],
	);
});

test('plan de rondas: se guarda de una vez y "avanzar" llena la ronda planificada', { skip }, async (t) => {
	const tournament = await ok('POST', '/tournaments', { name: `e2e rondas ${state.nonce} plan` }, state.adminToken);
	const planned = await ok('PUT', `/tournaments/${tournament.id}/plan`, {
		rounds: [
			{ round_number: 1, difficulty: 'easy', problemId: state.problem.id, capacity: 2, timeLimitSeconds: 600 },
			{ round_number: 2, difficulty: 'medium', problemId: state.problem.id, capacity: 1, timeLimitSeconds: 900 },
		],
	}, state.adminToken);
	assert.deepEqual(planned.map((row) => [row.round_number, row.difficulty, row.status]), [[1, 'easy', 'pending'], [2, 'medium', 'pending']]);
	const [first, second] = planned;
	state.rounds.push(first.id, second.id);

	// Un hueco en el plan se rechaza.
	const gap = await api('PUT', `/tournaments/${tournament.id}/plan`, {
		rounds: [{ round_number: 4, difficulty: 'hard', problemId: state.problem.id, capacity: 1, timeLimitSeconds: 600 }],
	}, state.adminToken);
	assert.equal(gap.status, 400);

	// Sala de espera: se inscriben en la ronda 1 antes de que empiece.
	const users = await register(tournament.id, ['plan-a', 'plan-b', 'plan-c']);
	for (const user of Object.values(users)) await ok('POST', `/rounds/${first.id}/participants/join`, { character: 47 }, user.token);
	assert.equal((await roster(first.id)).length, 3);
	const board = await ok('GET', `/rounds/${first.id}/leaderboard`);
	assert.equal(board[0].character, 47, 'el ranking trae el personaje');
	const { rows: active } = await state.db.query("SELECT 1 FROM rounds WHERE status = 'active' LIMIT 1");
	if (!active.length) {
		const upcoming = await ok('GET', '/public/rounds/upcoming', undefined, users['plan-a'].token);
		t.diagnostic(`sala de espera -> ${JSON.stringify(upcoming)}`);
		assert.ok(upcoming, 'sin ronda activa debería haber una ronda que esperar');
	}

	await ok('POST', `/rounds/${first.id}/start`, {}, state.adminToken);
	await ok('POST', `/rounds/${first.id}/close`, {}, state.adminToken);
	const preview = await ok('GET', `/rounds/${first.id}/next`, undefined, state.adminToken);
	t.diagnostic(`vista previa -> ${JSON.stringify(preview.existing)}`);
	assert.equal(preview.available, true);
	assert.equal(preview.existing.planned, true);
	assert.equal(preview.existing.id, second.id);

	const filled = await api('POST', `/rounds/${first.id}/next`, { problemId: state.problem.id, timeLimitSeconds: 900 }, state.adminToken);
	assert.equal(filled.status, 201);
	assert.equal(filled.body.round.id, second.id, 'llenó la ronda planificada, no creó otra');
	assert.equal((await roster(second.id)).length, 2);
	const again = await api('POST', `/rounds/${first.id}/next`, { problemId: state.problem.id, timeLimitSeconds: 900 }, state.adminToken);
	assert.equal(again.status, 409);
});

test('los códigos invalidados no aparecen en la lista', { skip }, async () => {
	const tournament = await ok('POST', '/tournaments', { name: `e2e rondas ${state.nonce} codigos` }, state.adminToken);
	const { codes } = await ok('POST', '/access-codes/generate', { count: 2, tournamentId: tournament.id }, state.adminToken);
	await ok('POST', '/access-codes/revoke', { codes: [codes[0].code] }, state.adminToken);
	const listed = await ok('GET', `/access-codes?tournamentId=${tournament.id}`, undefined, state.adminToken);
	assert.deepEqual(listed.map((row) => row.code), [codes[1].code]);
});

test.after(async () => {
	if (!enabled) return;
	// Ninguna ronda de la prueba queda activa: /public/rounds/active las mostraría.
	for (const roundId of state.rounds) {
		await api('POST', `/rounds/${roundId}/close`, {}, state.adminToken).catch(() => undefined);
	}
	await state.db?.end();
});
