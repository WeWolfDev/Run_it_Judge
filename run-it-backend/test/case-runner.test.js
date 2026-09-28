// Planificador de casos contra Judge0. Sin base, sin Redis y sin Judge0:
// runCase es un doble con demoras controladas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter, runTestCases } = require('../case-runner');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Cuenta cuántos casos hay en vuelo a la vez, como los vería Judge0.
function tracker() {
	const state = { active: 0, peak: 0, started: 0 };
	state.wrap = (fn) => async (...args) => {
		state.active += 1;
		state.started += 1;
		state.peak = Math.max(state.peak, state.active);
		try {
			return await fn(...args);
		} finally {
			state.active -= 1;
		}
	};
	return state;
}

test('results[i] es la salida de testCases[i] aunque los casos terminen al revés', async () => {
	// El primer caso es el más lento y el último el más rápido: con push al
	// resolver, results saldría invertido.
	const testCases = [
		{ stdin: 'lento\n', expected: 'LENTO' },
		{ stdin: 'medio\n', expected: 'MEDIO' },
		{ stdin: 'rapido\n', expected: 'RAPIDO' },
		{ stdin: 'instantaneo\n', expected: 'INSTANTANEO' },
	];
	const delays = [120, 60, 20, 0];
	const finished = [];
	const results = await runTestCases(testCases, async (testCase, index) => {
		await sleep(delays[index]);
		finished.push(index);
		return { stdout: testCase.stdin.trim().toUpperCase(), stdin: testCase.stdin };
	}, createLimiter(8));

	assert.deepEqual(finished, [3, 2, 1, 0], 'los casos tienen que terminar en orden inverso');
	assert.deepEqual(results.map((result) => result.stdin), testCases.map((testCase) => testCase.stdin));
	assert.deepEqual(results.map((result) => result.stdout), testCases.map((testCase) => testCase.expected));
});

test('el orden se mantiene cuando el tope obliga a hacer varias tandas', async () => {
	const testCases = Array.from({ length: 30 }, (_, index) => ({ stdin: `${index}\n` }));
	const results = await runTestCases(testCases, async (testCase, index) => {
		await sleep((30 - index) % 7);
		return testCase.stdin;
	}, createLimiter(2));
	assert.deepEqual(results, testCases.map((testCase) => testCase.stdin));
});

test('nunca hay más casos en vuelo que el tope, sumando todos los jobs', async () => {
	const limiter = createLimiter(8);
	const inFlight = tracker();
	const runCase = inFlight.wrap(async () => sleep(5 + Math.floor(Math.random() * 15)));
	// 20 jobs de 7 casos a la vez: 140 casos contra 8 permisos.
	const jobs = Array.from({ length: 20 }, () =>
		runTestCases(Array.from({ length: 7 }, (_, index) => ({ stdin: `${index}` })), runCase, limiter));
	await Promise.all(jobs);

	assert.equal(inFlight.started, 140);
	assert.equal(inFlight.peak, 8, 'tiene que llegar al tope y no pasarlo');
	assert.deepEqual(limiter.stats(), { active: 0, waiting: 0 });
});

test('un job solo usa todo el tope y no más', async () => {
	const inFlight = tracker();
	await runTestCases(Array.from({ length: 30 }, () => ({})), inFlight.wrap(() => sleep(10)), createLimiter(8));
	assert.equal(inFlight.peak, 8);
});

test('un caso que lanza no se lleva el permiso ni deja lanzar más casos', async () => {
	const limiter = createLimiter(2);
	const started = [];
	let slowFinished = false;
	const failure = new Error('Judge0 503');
	const run = runTestCases(Array.from({ length: 10 }, (_, index) => ({ index })), async (testCase) => {
		started.push(testCase.index);
		if (testCase.index === 0) {
			await sleep(50);
			slowFinished = true;
			return 'ok';
		}
		if (testCase.index === 1) throw failure;
		return 'ok';
	}, limiter);

	await assert.rejects(run, (error) => error === failure);
	// El caso 0 ya estaba en Judge0: se espera a que termine antes de rechazar,
	// para que el reintento de BullMQ no se superponga con él.
	assert.equal(slowFinished, true);
	assert.deepEqual(started.sort(), [0, 1], 'después del fallo no sale ningún caso nuevo');
	assert.deepEqual(limiter.stats(), { active: 0, waiting: 0 });
});

test('muchos jobs que fallan no dejan el tope reducido', async () => {
	const limiter = createLimiter(8);
	const failing = Array.from({ length: 50 }, (_, job) =>
		runTestCases(Array.from({ length: 5 }, (_, index) => ({ index })), async (testCase) => {
			await sleep(testCase.index);
			if (testCase.index === job % 5) throw new Error(`fallo ${job}`);
			return testCase.index;
		}, limiter));
	const outcomes = await Promise.allSettled(failing);
	assert.ok(outcomes.every((outcome) => outcome.status === 'rejected'));
	assert.deepEqual(limiter.stats(), { active: 0, waiting: 0 });

	// Si se hubiera perdido un solo permiso, este job no llegaría a 8.
	const inFlight = tracker();
	await runTestCases(Array.from({ length: 8 }, () => ({})), inFlight.wrap(() => sleep(20)), limiter);
	assert.equal(inFlight.peak, 8);
});

test('un fallo síncrono en runCase también devuelve el permiso', async () => {
	const limiter = createLimiter(1);
	await assert.rejects(runTestCases([{}], () => {
		throw new Error('síncrono');
	}, limiter), /síncrono/);
	assert.deepEqual(limiter.stats(), { active: 0, waiting: 0 });
	assert.deepEqual(await runTestCases([{}], async () => 'ok', limiter), ['ok']);
});

test('sin casos no llama a Judge0', async () => {
	let calls = 0;
	const results = await runTestCases([], async () => {
		calls += 1;
	}, createLimiter(8));
	assert.deepEqual(results, []);
	assert.equal(calls, 0);
});

test('el tope tiene que ser un entero positivo', () => {
	for (const max of [0, -1, 1.5, Number.NaN]) {
		assert.throws(() => createLimiter(max), /Presupuesto de Judge0 inválido/);
	}
});
