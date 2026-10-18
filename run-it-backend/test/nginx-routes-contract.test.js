// Las plantillas de Nginx (deploy/nginx) mandan al backend solo los prefijos de
// su regex; el resto va al frontend. Una ruta nueva cuyo prefijo no esté ahí
// responde 404 en producción aunque los tests pasen (pasó con /casters y
// /hits/polls). DB-free: compara las rutas de los módulos con las plantillas.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');
const CASTER_ROUTES_SOURCE = fs.readFileSync(path.join(__dirname, '../caster/routes.js'), 'utf8');
const NGINX_DIR = path.join(__dirname, '../../deploy/nginx');

const backendPrefixes = [
	...new Set(
		[INDEX_SOURCE, CASTER_ROUTES_SOURCE]
			.flatMap((source) =>
				[...source.matchAll(/fastify\.(?:get|post|put|delete|patch)\('\/([a-z-]+)/g)].map((m) => m[1]),
			),
	),
].sort();

function proxiedPrefixes(file) {
	const conf = fs.readFileSync(path.join(NGINX_DIR, file), 'utf8');
	const match = conf.match(/location ~ \^\/\(([^)]+)\)\(\/\|\$\)/);
	assert.ok(match, `${file}: falta la location con la regex de rutas del backend`);
	return match[1].split('|');
}

test('el backend tiene rutas (sanity)', () => {
	assert.ok(backendPrefixes.includes('rounds') && backendPrefixes.includes('caster'));
});

for (const file of ['runit-https.conf', 'runit-tailscale.conf']) {
	test(`${file} manda al backend todos los prefijos de index.js`, () => {
		const proxied = proxiedPrefixes(file);
		const missing = backendPrefixes.filter((prefix) => !proxied.includes(prefix));
		assert.deepEqual(missing, [], `${file} no enruta: ${missing.join(', ')}`);
	});

	test(`${file} enruta /socket.io/ con upgrade a websocket`, () => {
		const conf = fs.readFileSync(path.join(NGINX_DIR, file), 'utf8');
		const block = conf.slice(conf.indexOf('location /socket.io/'));
		assert.match(block.slice(0, 600), /proxy_set_header Upgrade \$http_upgrade;/);
	});
}
