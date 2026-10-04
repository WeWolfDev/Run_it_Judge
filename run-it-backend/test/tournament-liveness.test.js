// Que ningún torneo quede trabado: el cierre automático sobrevive a una ronda
// que falla, y una ronda sin clasificados deja terminar el torneo. DB-free.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_SOURCE = fs.readFileSync(path.join(__dirname, '../index.js'), 'utf8');

test('el cierre automático atrapa el error de cada ronda vencida', () => {
	const loop = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf("SELECT id FROM rounds WHERE status = 'active' AND ends_at <= now()"));
	const body = loop.slice(0, loop.indexOf('}, 1000)'));
	assert.match(body, /try \{\s*await closeRound\(round\.id\);\s*\} catch/);
});

test('sin clasificados la vista previa pide terminar el torneo', () => {
	const preview = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf('async function nextRoundPreview'));
	assert.match(preview, /advancing\.rows\.length === 0[\s\S]*Terminá el torneo/);
});

test('POST /tournaments/:id/finish termina cualquier torneo, sin condiciones de estado', () => {
	const finish = INDEX_SOURCE.slice(INDEX_SOURCE.indexOf("fastify.post('/tournaments/:id/finish'"));
	assert.match(finish.slice(0, 400), /UPDATE tournaments SET status = 'finished' WHERE id = \$1 RETURNING \*/);
});
