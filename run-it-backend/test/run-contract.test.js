// Contrato de POST /rounds/:id/run ("Probar código"). DB-free: valida el
// payload, el rol y cómo se resume la respuesta de Judge0, sin Postgres, Redis
// ni Judge0. La prueba contra el juez real vive en judge.e2e.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const { fastify, sessions, validateRunPayload, summarizeRun } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

function runAs(role, payload) {
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: 'contrato', role });
	return fastify.inject({
		method: 'POST',
		url: `/rounds/${crypto.randomUUID()}/run`,
		headers: { authorization: `Bearer ${token}` },
		payload,
	});
}

const base = { participantId: crypto.randomUUID(), code: 'print(1)', language: 'python' };

test('validateRunPayload acepta los tres lenguajes, con y sin entrada propia', () => {
	for (const language of ['python', 'c', 'cpp']) {
		assert.equal(validateRunPayload({ ...base, language }), null);
		assert.equal(validateRunPayload({ ...base, language, stdin: '1 2\n' }), null);
	}
	assert.equal(validateRunPayload({ ...base, stdin: '' }), null, 'una entrada vacía es válida');
});

test('validateRunPayload rechaza código vacío, lenguajes ajenos y entradas enormes', () => {
	assert.match(validateRunPayload({ ...base, code: '' }), /Código inválido/);
	assert.match(validateRunPayload({ ...base, code: 'x'.repeat(100_001) }), /Código inválido/);
	assert.match(validateRunPayload({ ...base, language: 'c++' }), /Lenguaje no soportado/);
	assert.match(validateRunPayload({ ...base, stdin: 'x'.repeat(64 * 1024 + 1) }), /64 KB/);
	assert.match(validateRunPayload({ ...base, stdin: 42 }), /64 KB/);
	assert.match(validateRunPayload(undefined), /Código inválido/);
});

test('POST /rounds/:id/run exige sesión de participante', async () => {
	const anonymous = await fastify.inject({ method: 'POST', url: `/rounds/${crypto.randomUUID()}/run`, payload: base });
	assert.equal(anonymous.statusCode, 401);
	const admin = await runAs('admin', base);
	assert.equal(admin.statusCode, 403);
});

test('POST /rounds/:id/run responde 400 antes de tocar la base', async () => {
	const response = await runAs('participant', { ...base, language: 'java' });
	assert.equal(response.statusCode, 400);
	assert.match(JSON.parse(response.body).error, /Lenguaje no soportado/);
});

test('summarizeRun compara contra la salida esperada ignorando espacios al borde', () => {
	const ok = summarizeRun({ status: { id: 3, description: 'Accepted' }, stdout: '5\n' }, { stdin: '2 3', expected: '5' });
	assert.equal(ok.passed, true);
	assert.equal(ok.status, 'Accepted');
	const wrong = summarizeRun({ status: { id: 3, description: 'Accepted' }, stdout: '6\n' }, { stdin: '2 3', expected: '5' });
	assert.equal(wrong.passed, false);
	assert.equal(wrong.status, 'Wrong Answer');
	const compile = summarizeRun(
		{ status: { id: 6, description: 'Compilation Error' }, compile_output: 'error: expected ;' },
		{ stdin: '', expected: '5' },
	);
	assert.equal(compile.passed, false);
	assert.equal(compile.status, 'Compilation Error');
	assert.match(compile.compile_output, /expected ;/);
});

test('summarizeRun con entrada propia no inventa un veredicto', () => {
	const custom = summarizeRun({ status: { id: 3, description: 'Accepted' }, stdout: 'hola' }, { stdin: 'x' });
	assert.equal('passed' in custom, false);
	assert.equal('expected' in custom, false);
	assert.equal(custom.stdout, 'hola');
});

test('summarizeRun recorta salidas largas', () => {
	const long = summarizeRun({ status: { id: 3, description: 'Accepted' }, stdout: 'a'.repeat(10_000) }, { stdin: '' });
	assert.ok(long.stdout.length < 4100);
	assert.match(long.stdout, /salida recortada/);
});

test('probar código no escribe en la base ni emite eventos', () => {
	const start = INDEX_SOURCE.indexOf("fastify.post('/rounds/:id/run'");
	const end = INDEX_SOURCE.indexOf("fastify.get('/rounds/:id/leaderboard'");
	assert.ok(start > 0 && end > start, 'No se encontró la ruta /rounds/:id/run');
	const route = INDEX_SOURCE.slice(start, end);
	assert.doesNotMatch(route, /INSERT|UPDATE|DELETE/i, 'la prueba no debe guardar nada');
	assert.doesNotMatch(route, /submissionQueue|fastify\.io/, 'la prueba no pasa por la cola ni por el socket');
	assert.match(route, /is_sample === true/, 'solo corre los casos marcados como ejemplo');
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
