// Batería del motor de evaluación contra Judge0 real. Caja negra: habla HTTP
// con el backend de desarrollo (deploy/dev-branch.sh up, :5000), consulta
// run_it_dev con pg, escucha el socket real y pregunta a Judge0 por token.
//
// Se saltea por defecto. Para correrla:
//   RUN_IT_JUDGE_E2E=1 node --test test/judge.e2e.test.js
//
// Judge0 es el mismo que usa producción: el TLE va al final, en un solo
// lenguaje y con un solo caso, para ocupar un worker el menor tiempo posible.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const enabled = process.env.RUN_IT_JUDGE_E2E === '1';
const skip = enabled ? false : 'RUN_IT_JUDGE_E2E=1 para correr contra Judge0 real';

const API_URL = process.env.RUN_IT_E2E_API_URL || 'http://127.0.0.1:5000';
const JUDGE0_URL = process.env.JUDGE0_URL || 'http://127.0.0.1:2358';
const DB_NAME = process.env.RUN_IT_E2E_DB_NAME || 'run_it_dev';
const ADMIN_USERNAME = process.env.RUN_IT_DEV_ADMIN_USERNAME || 'devadmin';
const ADMIN_ACCESS_CODE = process.env.RUN_IT_DEV_ADMIN_ACCESS_CODE || 'dev-admin-dev';
const VERDICT_TIMEOUT_MS = 90_000;
const HUNDRED_TIMEOUT_MS = 600_000;

// La contraseña del rol de desarrollo vive en el state dir de dev-branch.sh.
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
	const dbName = new URL(url).pathname.slice(1);
	assert.equal(dbName, DB_NAME, 'La batería solo corre contra la base de desarrollo');
	assert.ok(!['run_it', 'judge0'].includes(dbName), `Base prohibida: ${dbName}`);
	const api = new URL(API_URL);
	assert.ok(['127.0.0.1', 'localhost'].includes(api.hostname), 'El backend tiene que ser local');
	assert.notEqual(api.port, '3001', ':3001 es el backend de producción');
}

const SUM_CASES = [
	{ stdin: '2 3\n', expected: '5' },
	{ stdin: '10 -4\n', expected: '6' },
];

const PROGRAMS = {
	python: {
		accepted: 'a, b = map(int, input().split())\nprint(a + b)\n',
		wrong: 'a, b = map(int, input().split())\nprint(a - b)\n',
		runtime: 'a, b = map(int, input().split())\nprint(a // (b - b))\n',
	},
	c: {
		accepted: [
			'#include <stdio.h>',
			'int main() {',
			'    char line[64];',
			'    long a, b;',
			'    if (!fgets(line, sizeof line, stdin)) return 0;',
			'    sscanf(line, "%ld %ld", &a, &b);',
			'    printf("%ld\\n", a + b);',
			'    return 0;',
			'}',
		].join('\n'),
		wrong: [
			'#include <stdio.h>',
			'int main() {',
			'    char line[64];',
			'    long a, b;',
			'    if (!fgets(line, sizeof line, stdin)) return 0;',
			'    sscanf(line, "%ld %ld", &a, &b);',
			'    printf("%ld\\n", a - b);',
			'    return 0;',
			'}',
		].join('\n'),
		// volatile: el divisor sale de la entrada y el compilador no puede plegar la división.
		runtime: [
			'#include <stdio.h>',
			'int main() {',
			'    char line[64];',
			'    long a, b;',
			'    if (!fgets(line, sizeof line, stdin)) return 0;',
			'    sscanf(line, "%ld %ld", &a, &b);',
			'    volatile long zero = b - b;',
			'    printf("%ld\\n", a / zero);',
			'    return 0;',
			'}',
		].join('\n'),
		compilation: '#include <stdio.h>\nint main() {\n    printf("%d\\n", 1)\n    return 0\n}\n',
	},
	cpp: {
		accepted: [
			'#include <iostream>',
			'using namespace std;',
			'int main() {',
			'    ios_base::sync_with_stdio(false);',
			'    cin.tie(NULL);',
			'    long a, b;',
			'    cin >> a >> b;',
			"    cout << a + b << '\\n';",
			'    return 0;',
			'}',
		].join('\n'),
		wrong: [
			'#include <iostream>',
			'using namespace std;',
			'int main() {',
			'    ios_base::sync_with_stdio(false);',
			'    cin.tie(NULL);',
			'    long a, b;',
			'    cin >> a >> b;',
			"    cout << a - b << '\\n';",
			'    return 0;',
			'}',
		].join('\n'),
		runtime: [
			'#include <iostream>',
			'using namespace std;',
			'int main() {',
			'    ios_base::sync_with_stdio(false);',
			'    cin.tie(NULL);',
			'    long a, b;',
			'    cin >> a >> b;',
			'    volatile long zero = b - b;',
			"    cout << a / zero << '\\n';",
			'    return 0;',
			'}',
		].join('\n'),
		compilation: '#include <iostream>\nusing namespace std;\nint main() {\n    ios_base::sync_with_stdio(false);\n    cin.tie(NULL);\n    cout << "x" <<\n}\n',
	},
};

const JUDGE0_LANGUAGE_IDS = { python: 71, c: 50, cpp: 54 };

// El caso 4 lanza una división por cero y el 50 imprime mal: el veredicto tiene
// que ser el del caso 4, el primer fallo, no el del 50 ni accepted.
const HUNDRED_CASES = Array.from({ length: 100 }, (_, index) => ({
	stdin: `${index + 1}\n`,
	expected: String(index + 1),
}));
const HUNDRED_PROGRAM = [
	'n = int(input())',
	'if n == 4:',
	'    print(n // (n - n))',
	'print(-1 if n == 50 else n)',
].join('\n');

const TLE_PROGRAM = 'while True:\n    pass\n';

// Los casos corren en paralelo y terminan en otro orden: los impares duermen y
// responden bien, los pares responden al instante y mal. Si results se armara
// por orden de llegada, el patrón de aprobados saldría corrido.
const ORDER_CASES = Array.from({ length: 6 }, (_, index) => ({
	stdin: `${index + 1}\n`,
	expected: String((index + 1) * 10),
}));
const ORDER_PROGRAM = [
	'import time',
	'n = int(input())',
	'if n % 2 == 1:',
	'    time.sleep(0.8)',
	'    print(n * 10)',
	'else:',
	'    print(n * 10 + 1)',
].join('\n');

const state = {
	nonce: crypto.randomBytes(3).toString('hex'),
	rounds: [],
	lastSubmitAt: new Map(),
	feed: new Map(),
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
	const json = text ? JSON.parse(text) : null;
	if (!response.ok) {
		throw new Error(`${method} ${url} -> ${response.status}: ${text}`);
	}
	return json;
}

async function createRound(roundNumber, problem, capacity) {
	const problemRow = await api('POST', '/problems', {
		name: `e2e juez ${state.nonce} ${problem.name}`,
		statement: problem.name,
		testCases: problem.testCases,
	}, state.adminToken);
	const round = await api('POST', '/rounds', {
		tournamentId: state.tournament.id,
		roundNumber,
		problemId: problemRow.id,
		capacity,
		timeLimitSeconds: 3600,
	}, state.adminToken);
	state.rounds.push(round.id);
	return round;
}

async function enroll(label, accessCode, roundIds) {
	const { token } = await api('POST', '/auth/register', {
		username: `e2e-${label}-${state.nonce}`,
		accessCode,
	});
	let participant;
	for (const roundId of roundIds) {
		participant = await api('POST', `/rounds/${roundId}/participants/join`, {}, token);
	}
	return { token, participantId: participant.id };
}

// Envía como lo hace ParticipantView: participantId, code y el value del <option>.
// Espera el evento submission:queued del feed del admin antes de devolver.
async function submit(participant, roundId, language, code) {
	const last = state.lastSubmitAt.get(participant.token) || 0;
	const wait = 1100 - (Date.now() - last);
	if (wait > 0) await sleep(wait);
	const queued = await api('POST', `/rounds/${roundId}/submissions`, {
		participantId: participant.participantId,
		code,
		language,
	}, participant.token);
	state.lastSubmitAt.set(participant.token, Date.now());
	assert.equal(queued.verdict, 'queued');
	assert.equal(queued.language, language);

	const deadline = Date.now() + 5000;
	while (!state.feed.has(queued.id)) {
		assert.ok(Date.now() < deadline, `submission:queued no llegó al feed para ${queued.id}`);
		await sleep(50);
	}
	const event = state.feed.get(queued.id);
	assert.equal(event.round_id, roundId);
	assert.equal(event.language, language);
	return queued.id;
}

async function waitVerdict(submissionId, timeoutMs = VERDICT_TIMEOUT_MS) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const { rows } = await state.db.query(
			`SELECT id, language, verdict, judge0_token, test_cases_passed, test_cases_total, case_results
			 FROM submissions WHERE id = $1`,
			[submissionId],
		);
		if (rows[0].verdict !== 'queued') return rows[0];
		assert.ok(Date.now() < deadline, `Sin veredicto después de ${timeoutMs} ms`);
		await sleep(300);
	}
}

async function roundParticipant(roundId, participantId) {
	const { rows } = await state.db.query(
		`SELECT rp.penalty_seconds, rp.failed_attempts_count, rp.solved_at,
		        COALESCE(r.starts_at, r.started_at) AS started_at
		 FROM round_participants rp JOIN rounds r ON r.id = rp.round_id
		 WHERE rp.round_id = $1 AND rp.participant_id = $2`,
		[roundId, participantId],
	);
	return rows[0];
}

async function judge0Submission(token) {
	const fields = 'token,language_id,status,stdout,stderr,compile_output,time,memory';
	const response = await fetch(`${JUDGE0_URL}/submissions/${token}?base64_encoded=false&fields=${fields}`);
	assert.equal(response.status, 200, `Judge0 no conoce el token ${token}`);
	return response.json();
}

test('preparación: torneo, tres rondas y cinco participantes en run_it_dev', { skip }, async () => {
	const url = databaseUrl();
	assertDevelopmentTargets(url);
	const { Pool } = require('pg');
	state.db = new Pool({ connectionString: url, max: 2 });
	const { rows } = await state.db.query('SELECT current_database() AS name');
	assert.equal(rows[0].name, DB_NAME);

	// socket.io-client es dependencia del frontend; el backend no la declara.
	const frontendRequire = createRequire(path.join(__dirname, '../../frontend/package.json'));
	const { io } = frontendRequire('socket.io-client');
	state.socket = io(API_URL, { transports: ['websocket'], reconnection: false });
	state.socket.on('submission:queued', (event) => state.feed.set(event.id, event));
	await new Promise((resolve, reject) => {
		state.socket.once('connect', resolve);
		state.socket.once('connect_error', reject);
	});

	const login = await api('POST', '/auth/login', { username: ADMIN_USERNAME, accessCode: ADMIN_ACCESS_CODE });
	state.adminToken = login.token;
	state.tournament = await api('POST', '/tournaments', { name: `e2e juez ${state.nonce}` }, state.adminToken);

	// Capacidad alta en las rondas 1 y 3: que nadie la cierre por cupo a mitad de la prueba.
	state.verdictRound = await createRound(1, { name: 'suma', testCases: SUM_CASES }, 50);
	state.hundredRound = await createRound(2, { name: 'cien casos', testCases: HUNDRED_CASES }, 50);
	state.penaltyRound = await createRound(3, { name: 'suma un caso', testCases: SUM_CASES.slice(0, 1) }, 5);
	state.orderRound = await createRound(4, { name: 'orden de casos', testCases: ORDER_CASES }, 50);

	const { codes } = await api('POST', '/access-codes/generate', {
		count: 6,
		tournamentId: state.tournament.id,
	}, state.adminToken);
	state.participants = {};
	for (const [index, language] of Object.keys(PROGRAMS).entries()) {
		state.participants[language] = await enroll(language, codes[index].code, [state.verdictRound.id]);
	}
	state.participants.hundred = await enroll('cien', codes[3].code, [state.hundredRound.id]);
	state.participants.penalty = await enroll('penal', codes[4].code, [state.penaltyRound.id]);
	state.participants.order = await enroll('orden', codes[5].code, [state.orderRound.id]);

	// POST /rounds/:id/start abre una cuenta regresiva: hasta starts_at el
	// backend rechaza los envíos con 409. Mismo host, mismo reloj.
	let startsAt = 0;
	for (const roundId of state.rounds) {
		const started = await api('POST', `/rounds/${roundId}/start`, {}, state.adminToken);
		startsAt = Math.max(startsAt, Date.parse(started.starts_at ?? '') || 0);
	}
	const wait = startsAt - Date.now() + 250;
	if (wait > 0) await sleep(wait);
});

for (const language of Object.keys(PROGRAMS)) {
	test(`veredictos en ${language}`, { skip }, async (t) => {
		const participant = state.participants[language];
		const roundId = state.verdictRound.id;
		const cases = [
			['accepted', 'accepted', 2],
			['wrong', 'Wrong Answer', 0],
			['runtime', /^Runtime Error/, 0],
		];
		if (PROGRAMS[language].compilation) cases.push(['compilation', 'Compilation Error', 0]);

		for (const [program, expected, passed] of cases) {
			const submissionId = await submit(participant, roundId, language, PROGRAMS[language][program]);
			const row = await waitVerdict(submissionId);
			t.diagnostic(`${language}/${program}: ${row.verdict} ${row.test_cases_passed}/${row.test_cases_total}`);
			if (expected instanceof RegExp) assert.match(row.verdict, expected);
			else assert.equal(row.verdict, expected);
			assert.equal(row.language, language);
			assert.equal(row.test_cases_total, 2);
			assert.equal(row.test_cases_passed, passed);
			assert.equal(row.case_results.length, 2);

			if (program === 'accepted') {
				const judged = await judge0Submission(row.judge0_token);
				t.diagnostic(`Judge0 ${row.judge0_token}: ${JSON.stringify(judged)}`);
				assert.equal(judged.language_id, JUDGE0_LANGUAGE_IDS[language]);
				assert.equal(judged.status.id, 3);
			}
		}
	});
}

test('100 casos con el 4 fallando: veredicto del primer fallo y conteo real', { skip }, async (t) => {
	const participant = state.participants.hundred;
	const submissionId = await submit(participant, state.hundredRound.id, 'python', HUNDRED_PROGRAM);
	const row = await waitVerdict(submissionId, HUNDRED_TIMEOUT_MS);
	t.diagnostic(`veredicto: ${row.verdict} ${row.test_cases_passed}/${row.test_cases_total}`);

	assert.match(row.verdict, /^Runtime Error/);
	assert.equal(row.test_cases_total, 100);
	assert.equal(row.test_cases_passed, 98);
	assert.equal(row.case_results.length, 100);
	row.case_results.forEach((caseResult, index) => {
		const expectedPass = index !== 3 && index !== 49;
		assert.equal(caseResult.passed, expectedPass, `caso ${index + 1}`);
	});
	assert.match(row.case_results[3].status, /^Runtime Error/);
	assert.equal(row.case_results[49].status, 'Wrong Answer');

	// Uno por caso: prueba de que Judge0 evaluó los 100 y no se cortó en el 4.
	const tokens = row.case_results.map((caseResult) => caseResult.token);
	t.diagnostic(`tokens por caso en case_results: ${tokens.filter(Boolean).length}; judge0_token: ${row.judge0_token}`);
	assert.equal(new Set(tokens.filter(Boolean)).size, 100, 'case_results no trae un judge0 token por caso');
	for (const [index, token] of tokens.entries()) {
		const judged = await judge0Submission(token);
		assert.equal(judged.language_id, 71);
		assert.equal(judged.status.id === 3, index !== 3, `caso ${index + 1}: ${judged.status.description}`);
	}
});

test('orden de casos: cada resultado queda pegado al stdin que lo produjo', { skip }, async (t) => {
	const submissionId = await submit(state.participants.order, state.orderRound.id, 'python', ORDER_PROGRAM);
	const row = await waitVerdict(submissionId);
	t.diagnostic(`veredicto: ${row.verdict} ${row.test_cases_passed}/${row.test_cases_total}`);

	assert.equal(row.verdict, 'Wrong Answer');
	assert.equal(row.test_cases_total, 6);
	assert.equal(row.test_cases_passed, 3);
	assert.deepEqual(row.case_results.map((caseResult) => caseResult.passed), [true, false, true, false, true, false]);

	// La prueba fuerte: Judge0 dice qué stdin corrió cada token de case_results.
	const finishedAt = [];
	for (const [index, caseResult] of row.case_results.entries()) {
		const response = await fetch(
			`${JUDGE0_URL}/submissions/${caseResult.token}?base64_encoded=false&fields=stdin,stdout,finished_at`,
		);
		const judged = await response.json();
		assert.equal(judged.stdin, ORDER_CASES[index].stdin, `caso ${index + 1}: stdin de otro caso`);
		const expectedStdout = index % 2 === 0 ? ORDER_CASES[index].expected : String((index + 1) * 10 + 1);
		assert.equal(judged.stdout.trim(), expectedStdout, `caso ${index + 1}: stdout de otro caso`);
		finishedAt.push(Date.parse(judged.finished_at));
	}
	// Sin esto el test no probaría nada: los casos tienen que haber terminado desordenados.
	t.diagnostic(`finished_at relativo: ${finishedAt.map((at) => at - Math.min(...finishedAt)).join(' ')}`);
	assert.ok(finishedAt[1] < finishedAt[0], 'el caso 2 (rápido) tenía que terminar antes que el 1 (lento)');
});

// Último a propósito: el TLE ocupa un worker de Judge0 hasta que lo corta.
test('penalización: WA, TLE, AC y un fallo posterior que no suma', { skip }, async (t) => {
	const participant = state.participants.penalty;
	const roundId = state.penaltyRound.id;

	const wrong = await waitVerdict(await submit(participant, roundId, 'python', PROGRAMS.python.wrong));
	assert.equal(wrong.verdict, 'Wrong Answer');
	let row = await roundParticipant(roundId, participant.participantId);
	assert.equal(row.penalty_seconds, 30);
	assert.equal(row.failed_attempts_count, 1);

	const startedAt = Date.now();
	const tle = await waitVerdict(await submit(participant, roundId, 'python', TLE_PROGRAM), 30_000);
	t.diagnostic(`TLE cortado por Judge0 en ${Date.now() - startedAt} ms: ${tle.verdict}`);
	assert.equal(tle.verdict, 'Time Limit Exceeded');
	row = await roundParticipant(roundId, participant.participantId);
	assert.equal(row.penalty_seconds, 60);
	assert.equal(row.failed_attempts_count, 2);

	const accepted = await waitVerdict(await submit(participant, roundId, 'python', PROGRAMS.python.accepted));
	assert.equal(accepted.verdict, 'accepted');
	row = await roundParticipant(roundId, participant.participantId);
	assert.equal(row.penalty_seconds, 60, 'penalty_seconds después del AC');
	assert.equal(row.failed_attempts_count, 2);
	assert.ok(row.solved_at, 'solved_at quedó vacío');

	const leaderboard = await api('GET', `/rounds/${roundId}/leaderboard`);
	const entry = leaderboard.find((item) => item.participant_id === participant.participantId);
	// El tiempo corre desde el fin de la cuenta regresiva (starts_at).
	const elapsed = (new Date(row.solved_at) - new Date(row.started_at)) / 1000;
	t.diagnostic(`solved_at - starts_at = ${elapsed.toFixed(3)} s; total_time_seconds = ${entry.total_time_seconds}`);
	assert.equal(entry.total_time_seconds, Math.round(elapsed + 60));
	assert.equal(entry.penalty_seconds, 60);

	// Regla ICPC: un fallo después de resolver no penaliza.
	const solvedAt = row.solved_at.toISOString();
	const after = await waitVerdict(await submit(participant, roundId, 'python', PROGRAMS.python.wrong));
	assert.equal(after.verdict, 'Wrong Answer');
	row = await roundParticipant(roundId, participant.participantId);
	assert.equal(row.penalty_seconds, 60, 'un fallo posterior al AC subió la penalización');
	assert.equal(row.failed_attempts_count, 2, 'un fallo posterior al AC subió el contador');
	assert.equal(row.solved_at.toISOString(), solvedAt);
});

test.after(async () => {
	if (!enabled) return;
	for (const roundId of state.rounds) {
		await api('POST', `/rounds/${roundId}/close`, {}, state.adminToken).catch(() => undefined);
	}
	state.socket?.close();
	await state.db?.end();
});
