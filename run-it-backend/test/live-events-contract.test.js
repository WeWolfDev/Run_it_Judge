// Actualización en vivo sin recargar la página: los cambios que ve el público
// salen por Socket.io. DB-free: se revisa el código de cada ruta, la cola de
// BullMQ diferida y el orden del esquema.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

/** El bloque de una ruta en index.js. */
function routeSource(signature) {
	const start = INDEX_SOURCE.indexOf(signature);
	assert.notEqual(start, -1, `falta la ruta ${signature}`);
	const end = INDEX_SOURCE.indexOf('\nfastify.', start + signature.length);
	return INDEX_SOURCE.slice(start, end === -1 ? undefined : end);
}

test('crear una ronda avisa a quien espera sin ronda activa', () => {
	assert.match(routeSource("fastify.post('/rounds'"), /emit\('round:created'/);
	assert.match(routeSource("fastify.post('/rounds/:id/next'"), /emit\('round:created'/);
});

test('cambiar el plan de rondas avisa a la sala de espera', () => {
	assert.match(routeSource("fastify.put('/tournaments/:id/plan'"), /emit\('rounds:planned'/);
});

test('corregir un problema avisa para releer el enunciado sin recargar', () => {
	const route = routeSource("fastify.put('/problems/:id'");
	assert.match(route, /emit\('problem:updated', \{ problem_id: request\.params\.id \}\)/);
	// Solo después de guardar: no antes de los 404 y 409.
	assert.ok(route.indexOf("emit('problem:updated'") > route.indexOf('outcome.blocking'));
});

test('la cola de envíos se crea al primer uso: importar no conecta a Redis', async () => {
	const queueSource = fs.readFileSync(path.join(__dirname, '../queue.js'), 'utf8');
	assert.doesNotMatch(queueSource, /^const submissionQueue = new Queue/m);
	assert.match(queueSource, /queue\.on\('error'/);
	const { submissionQueue } = require('../queue');
	// Sin usarla, cerrar no abre ninguna conexión y termina enseguida.
	const started = Date.now();
	await submissionQueue.close();
	assert.ok(Date.now() - started < 1000);
});

test('el esquema crea tournaments antes que access_codes, que la referencia', () => {
	const tournaments = SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS tournaments');
	const accessCodes = SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS access_codes');
	assert.ok(tournaments !== -1 && accessCodes !== -1);
	assert.ok(tournaments < accessCodes, 'en una base vacía access_codes fallaría');
	assert.equal(SCHEMA.split('CREATE TABLE IF NOT EXISTS tournaments').length, 2, 'una sola vez');
});
