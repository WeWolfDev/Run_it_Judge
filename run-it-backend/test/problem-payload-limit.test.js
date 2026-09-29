// Techo del cuerpo de un problema. DB-free: el 413 lo dispara el parser de Fastify
// antes de que corra cualquier hook, así que ni la sesión ni Postgres intervienen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const { fastify, MAX_BODY_BYTES } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

const MB = 1024 * 1024;

function payloadWithStdinOf(bytes) {
	return {
		name: 'pesado',
		statement: 'enunciado',
		difficulty: 'easy',
		testCases: [{ stdin: 'x'.repeat(bytes), expected: '1', is_sample: false }],
	};
}

test('un problema de 6 MB ya no se rechaza por tamaño', async () => {
	// El tamaño exacto del .zip que falló en producción antes del arreglo.
	const response = await fastify.inject({
		method: 'POST',
		url: '/problems',
		payload: payloadWithStdinOf(6 * MB),
	});

	// 401 = llegó al handler y solo le falta la sesión, que es lo que tiene que
	// pasar. Lo que no debe volver es 413.
	assert.notEqual(response.statusCode, 413);
});

test('un cuerpo sobre el techo responde 413 con un mensaje en JSON', async () => {
	const response = await fastify.inject({
		method: 'POST',
		url: '/problems',
		payload: payloadWithStdinOf(MAX_BODY_BYTES + MB),
	});

	assert.equal(response.statusCode, 413);
	assert.match(response.headers['content-type'] || '', /application\/json/);
	// Un motivo accionable, no el code interno de Fastify.
	assert.match(response.json().error, /16 MB/);
	assert.match(response.json().error, /Reducí los casos/);
});

test('el backend y el proxy comparten el mismo techo', () => {
	assert.equal(MAX_BODY_BYTES, 16 * MB);
	const vhost = fs.readFileSync(
		path.join(__dirname, '..', '..', 'deploy', 'nginx', 'runit-tailscale.conf'),
		'utf8',
	);
	// Si los dos divirgen, uno responde 413 con JSON y el otro con HTML, y el
	// frontend no puede distinguirlos.
	assert.match(vhost, /client_max_body_size\s+16m;/);
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
