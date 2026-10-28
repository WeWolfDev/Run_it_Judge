// Contrato de la autoinscripción en la primera ronda: la sala de espera y el
// join usan el mismo criterio para decidir si el torneo es del participante.
// DB-free: forma de las consultas. El comportamiento contra la base lo cubre
// rounds.e2e.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

function routeBody(signature) {
	const route = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf(signature));
	return route.slice(0, route.indexOf('\n});'));
}

test('la sala de espera solo ofrece la ronda 1 de un torneo que es del participante', () => {
	const body = routeBody("fastify.get('/public/rounds/upcoming'");
	assert.match(body, /selfEnrollAllowedSql\('r\.tournament_id', '\$1'\)/);
});

test('el join de la ronda 1 aplica el mismo criterio antes de inscribir', () => {
	const body = routeBody("fastify.post('/rounds/:id/participants/join'");
	const check = body.indexOf("selfEnrollAllowedSql('$1', '$2')");
	assert.ok(check > 0, 'el join no usa selfEnrollAllowedSql');
	assert.ok(check < body.indexOf('INSERT INTO participants'), 'el chequeo tiene que ir antes del INSERT');
	assert.match(body, /\[round\.rows\[0\]\.tournament_id, request\.user\.id\]/);
	assert.match(body, /reply\.code\(403\)\.send\(\{ error: 'Tu acceso es de otro torneo/);
});

test('el criterio mira el código reclamado y los otros torneos del usuario', () => {
	const fn = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf('function selfEnrollAllowedSql'));
	const body = fn.slice(0, fn.indexOf('\n}'));
	assert.match(body, /own\.tournament_id = \$\{tournament\} AND own\.user_id = \$\{user\}/);
	assert.match(body, /ac\.claimed_by_user_id = \$\{user\} AND ac\.tournament_id <> \$\{tournament\}/);
	assert.match(body, /other\.user_id = \$\{user\} AND other\.tournament_id <> \$\{tournament\}/);
});
