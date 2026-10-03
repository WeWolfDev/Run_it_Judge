// Contrato entre el selector de lenguaje del participante, la validación de
// POST /rounds/:id/submissions y el mapeo a Judge0. DB-free: no necesita
// Postgres, Redis ni Judge0, así que corre siempre con npm test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const { fastify, sessions } = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');
const { createSubmission } = require('../judge0-client');

const PARTICIPANT_VIEW = path.join(__dirname, '../../frontend/src/components/ParticipantView.tsx');
const participantView = fs.readFileSync(PARTICIPANT_VIEW, 'utf8');

// Las claves del objeto LANGUAGES son los value de cada <option>.
function objectKeys(source, declaration) {
	const start = source.indexOf(declaration);
	assert.notEqual(start, -1, `No se encontró ${declaration} en ParticipantView.tsx`);
	// Cierra en "};" o "} as const;". Un "}" suelto puede estar dentro de una plantilla.
	const end = start + source.slice(start).search(/\n\}( as const)?;/);
	const body = source.slice(start, end);
	return [...body.matchAll(/^ {2}(\w+): /gm)].map((match) => match[1]);
}

const frontendLanguages = objectKeys(participantView, 'const LANGUAGES = {');
const templateKeys = objectKeys(participantView, 'const TEMPLATES: Record<Language, string> = {');

// Contenido de cada plantilla tal como está en ParticipantView (template literal).
function templateSource(language) {
	const match = participantView.match(new RegExp(`\\n  ${language}: \`([\\s\\S]*?)\`,\\n`));
	assert.ok(match, `No se encontró la plantilla de ${language}`);
	return match[1].replace(/\\`/g, '`').replace(/\\\$\{/g, '${').replace(/\\\\/g, '\\');
}

async function capturedLanguageId(language) {
	const originalFetch = globalThis.fetch;
	let body;
	globalThis.fetch = async (url, options) => {
		body = JSON.parse(options.body);
		return new Response(JSON.stringify({ token: 'stub' }), { status: 201 });
	};
	try {
		await createSubmission('', language);
	} finally {
		globalThis.fetch = originalFetch;
	}
	return body.language_id;
}

async function submitAs(language) {
	// Un usuario por envío: el límite de 1 envío por segundo es por usuario.
	const token = crypto.randomUUID();
	sessions.set(token, { id: crypto.randomUUID(), username: 'contrato', role: 'participant' });
	return fastify.inject({
		method: 'POST',
		url: `/rounds/${crypto.randomUUID()}/submissions`,
		headers: { authorization: `Bearer ${token}` },
		payload: { participantId: crypto.randomUUID(), code: 'x', language },
	});
}

test('judge0-client usa GCC 9.2 para C y C++', async () => {
	assert.equal(await capturedLanguageId('python'), 71);
	assert.equal(await capturedLanguageId('c'), 50);
	assert.equal(await capturedLanguageId('cpp'), 54);
});

test('judge0-client rechaza "c++": toLowerCase no lo convierte en "cpp"', async () => {
	await assert.rejects(createSubmission('', 'c++'), /Lenguaje no soportado/);
	await assert.rejects(createSubmission('', 'C++'), /Lenguaje no soportado/);
	// Node y la JVM no arrancan en el sandbox de este host.
	await assert.rejects(createSubmission('', 'javascript'), /Lenguaje no soportado/);
	await assert.rejects(createSubmission('', 'java'), /Lenguaje no soportado/);
});

test('el selector ofrece exactamente los tres lenguajes del backend', () => {
	assert.deepEqual(frontendLanguages, ['python', 'c', 'cpp']);
	assert.match(participantView, /<option key=\{key\} value=\{key\}>/);
});

test('cada value del selector pasa la validación de POST /rounds/:id/submissions', async () => {
	for (const language of frontendLanguages) {
		const response = await submitAs(language);
		// Pasa la validación y sigue hacia Postgres, que acá no existe.
		assert.notEqual(response.statusCode, 400, `${language} fue rechazado: ${response.body}`);
	}
});

test('POST /rounds/:id/submissions rechaza variantes en mayúscula o con símbolos', async () => {
	for (const language of ['C++', 'c++', 'Cpp', 'CPP', 'C', 'Python', 'javascript', 'java']) {
		const response = await submitAs(language);
		assert.equal(response.statusCode, 400, `${language} debería dar 400`);
	}
});

test('cada lenguaje tiene su plantilla, idéntica a plantillas_lenguajes/*.md', () => {
	assert.deepEqual(templateKeys, frontendLanguages);
	for (const language of frontendLanguages) {
		const file = fs.readFileSync(path.join(__dirname, `../../plantillas_lenguajes/${language}.md`), 'utf8');
		assert.equal(templateSource(language), file, `La plantilla de ${language} no coincide con ${language}.md`);
	}
});

test('la plantilla es el código inicial y cambiar de lenguaje no pisa lo escrito', () => {
	assert.match(participantView, /useState\(TEMPLATES\.python\)/);
	assert.match(participantView, /value=\{code\}/);
	assert.match(participantView, /onChange=\{\(value\) => setCode\(value\)\}/);
	// Solo dos escrituras del código: lo que teclea y el cambio de lenguaje, que
	// únicamente reemplaza la plantilla intacta o el editor vacío.
	assert.equal(participantView.match(/setCode\(/g).length, 2);
	assert.match(participantView, /isUntouchedTemplate\(current\) \|\| !current\.trim\(\) \? TEMPLATES\[next\] : current/);
	assert.doesNotMatch(participantView, /PLACEHOLDERS/);
});

test('probar o enviar la plantilla sin cambios se rechaza en el cliente', () => {
	const guards = participantView.match(/if \(isUntouchedTemplate\(code\)\)/g) || [];
	assert.equal(guards.length, 2, 'falta el chequeo en send o en run');
});

test('las plantillas de C y C++ leen de stdin sin /dev/stdin', () => {
	assert.match(participantView, /ios_base::sync_with_stdio\(false\);/);
	assert.match(participantView, /cin\.tie\(NULL\);/);
	assert.doesNotMatch(participantView, /\/dev\/stdin/);
});

test.after(async () => {
	await fastify.close();
	await submissionQueue.close();
	await pool.end();
});
