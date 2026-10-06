// Quien ya resolvió todos los casos no puede enviar más en esa ronda. DB-free:
// revisa que la consulta del envío traiga solved_at y que corte antes de encolar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

test('POST /rounds/:id/submissions rechaza con 409 a quien ya clasificó, antes de encolar', () => {
	const start = INDEX_SOURCE.indexOf("fastify.post('/rounds/:id/submissions'");
	const route = INDEX_SOURCE.slice(start, INDEX_SOURCE.indexOf('\n});', start));
	assert.match(route, /SELECT p\.id, p\.display_name, rp\.solved_at FROM participants p/);
	const guard = route.indexOf('if (participant.rows[0].solved_at)');
	assert.ok(guard > 0, 'falta el corte por solved_at');
	assert.match(route.slice(guard, guard + 200), /reply\.code\(409\)/);
	assert.ok(guard < route.indexOf('INSERT INTO submissions'), 'el corte debe ir antes de guardar el envío');
	assert.ok(guard < route.indexOf('submissionQueue.add'), 'el corte debe ir antes de encolar');
});
