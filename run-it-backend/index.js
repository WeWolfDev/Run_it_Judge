// Un problema real con casos importados de un .zip pesa varios MB: enunciado,
// 100 entradas y 100 salidas. El bodyLimit por defecto de Fastify (1 MiB) los
// rechazaba con 413 sin llegar a leer el body, y el vhost de Nginx corta en el
// mismo valor. Los dos techos quedan en 16 MB y a propósito son el mismo número:
// si el proxy dejara pasar más que el backend, el 413 sería JSON y el del proxy
// no, y el frontend no podría distinguirlos.
const MAX_BODY_BYTES = 16 * 1024 * 1024;

const fastify = require('fastify')({
	logger: true,
	trustProxy: ['127.0.0.1', '::1'],
	bodyLimit: MAX_BODY_BYTES,
});

const crypto = require('node:crypto');
const cors = require('@fastify/cors');
const { Server } = require('socket.io');
const { initDb, query, withTransaction } = require('./db');
const { submissionQueue, startSubmissionWorker, judge0Slots } = require('./queue');
const { createSubmission, waitForSubmission } = require('./judge0-client');
const { createLimiter, runTestCases } = require('./case-runner');
const { computeAwards } = require('./awards');
const {
  setSession,
  getSession,
  deleteSession,
  getSessionStoreStatus,
  memorySessions,
} = require('./session-store');

const submissionRate = new Map();
const runRate = new Map();
const authFailures = new Map();
const authFailureWindowMs = Number(process.env.AUTH_FAILURE_WINDOW_MS || 15 * 60 * 1000);
// Dos limites distintos porqueprotegen cosas distintas. La identidad es el
// objetivo real de un ataque de fuerza bruta: 5 intentos por cuenta. La IP es
// solo una capa extra, y aqui es contraproducente: 50 participantes del torneo
// comparten la misma IP del Wi-Fi de la oficina, asi que un tecleo de cualquiera
// sumaba para todos y, peor, un login exitoso no borra el contador de IP, con lo
// que el ultimo en entrar con el codigo correcto tambien recibia 429. El tope por
// IP va muy por encima para tolerar el grupejo sin perder la capa.
const authIdentityLimit = Number(process.env.AUTH_IDENTITY_FAILURE_LIMIT || 5);
// El tope por IP tiene que absorber a todo el grupo contendiendo por la misma
// IP: 50 participantes con un tecleo cada uno ya son 50. Se eligio 200 para que
// dos vueltos de la ronda no alcancen a cortar a nadie, sin que la capa deje de
// ser util: el limite por identidad (5) sigue siendo el que protege la cuenta.
const authIpLimit = Number(process.env.AUTH_IP_FAILURE_LIMIT || 200);

function normalizeAuthIdentity(value) {
	return String(value || '').trim().toLowerCase().slice(0, 128);
}

function getAuthFailure(key) {
	const now = Date.now();
	const current = authFailures.get(key);
	if (!current || now - current.firstFailureAt >= authFailureWindowMs) {
		authFailures.delete(key);
		return null;
	}
	return current;
}

function authLimitForKey(key) {
	return key.startsWith('ip:') ? authIpLimit : authIdentityLimit;
}

function authRetryAfter(request, identity) {
	// Se evalua primero la identidad y se corta en cuanto esa bloquea: si una
	// cuenta esta bloqueada, el 429 no cambia por mirar tambien la IP. Evita
	// mezclar el dato de una cuenta con el ruido agregado de la red.
	const normalizedIdentity = normalizeAuthIdentity(identity);
	const keys = [];
	if (normalizedIdentity) keys.push(`identity:${normalizedIdentity}`);
	keys.push(`ip:${request.ip}`);

	for (const key of keys) {
		const failure = getAuthFailure(key);
		if (!failure) continue;
		if (failure.count < authLimitForKey(key)) continue;
		const remainingMs = authFailureWindowMs - (Date.now() - failure.firstFailureAt);
		if (remainingMs > 0) return Math.ceil(remainingMs / 1000);
	}
	return 0;
}

function rejectLimitedAuth(request, reply, identity) {
	const retryAfter = authRetryAfter(request, identity);
	if (!retryAfter) return false;
	reply.header('Retry-After', String(retryAfter));
	return reply.code(429).send({ error: 'Demasiados intentos; prueba más tarde' });
}

function recordAuthFailure(request, identity) {
	const now = Date.now();
	const keys = [`ip:${request.ip}`];
	const normalizedIdentity = normalizeAuthIdentity(identity);
	if (normalizedIdentity) keys.push(`identity:${normalizedIdentity}`);

	for (const key of keys) {
		const current = getAuthFailure(key);
		if (current) current.count += 1;
		else authFailures.set(key, { count: 1, firstFailureAt: now });
	}
}

function clearIdentityAuthFailures(identity) {
	const normalizedIdentity = normalizeAuthIdentity(identity);
	if (normalizedIdentity) authFailures.delete(`identity:${normalizedIdentity}`);
}

// Un acierto prueba que quien camea no esta atacando esa IP, asi que tambien
// libera el contador de IP. Sin esto, fifty personas del mismo Wi-Fi se bloqueaban
// entre si: los fallos de uno congelaban la entrada del resto durante 15 minutos
// y el que Finally escribia bien su codigo tambien recibia 429.
function clearAuthFailuresForRequest(request, identity) {
	clearIdentityAuthFailures(identity);
	authFailures.delete(`ip:${request.ip}`);
}

setInterval(() => {
	const now = Date.now();
	for (const [key, failure] of authFailures) {
		if (now - failure.firstFailureAt >= authFailureWindowMs) authFailures.delete(key);
	}
}, authFailureWindowMs).unref();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080')
	.split(',')
	.map((origin) => origin.trim())
	.filter(Boolean);

// Kahoot-style short codes. The alphabet drops I, O, 0 and 1 so codes survive
// being read aloud or copied off a whiteboard. 32 symbols, 6 characters:
// 30 bits of entropy, about a billion combinations.
const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ACCESS_CODE_LENGTH = 6;
const ACCESS_CODE_MAX_COUNT = 500;
// Igual que CHARACTER_COUNT de frontend/src/lib/session.ts: un índice por
// personaje de frontend/src/lib/characters.ts.
const CHARACTER_COUNT = 48;
// Cuenta regresiva entre POST /rounds/:id/start y el primer envío aceptado.
const ROUND_COUNTDOWN_SECONDS = 10;

const ROUND_STATUS_TEXT = {
	pending: 'pendiente',
	active: 'en curso',
	closing: 'cerrándose',
	closed: 'cerrada',
};

// Rondas anteriores de r (mismo torneo) que todavía no cerraron. Mientras haya
// alguna, r no puede iniciar. 'closing' cuenta como abierta: closeRound todavía
// no terminó de rankear. Espera un alias r sobre rounds.
const OPEN_PREVIOUS_ROUNDS_SQL = `
	SELECT prev.round_number, prev.status FROM rounds prev
	WHERE prev.tournament_id = r.tournament_id
	  AND prev.round_number < r.round_number
	  AND prev.status <> 'closed'`;

// Motivo legible de por qué una ronda no puede iniciar. Lo usan el 409 de
// POST /rounds/:id/start y el listado de progreso, para que el panel muestre
// el mismo texto antes de que el admin apriete.
function describeStartBlock(blockers) {
	const sorted = [...blockers].sort((a, b) => a.round_number - b.round_number);
	if (sorted.length === 1) {
		const [only] = sorted;
		return `Cerrá la ronda ${only.round_number} primero: está ${ROUND_STATUS_TEXT[only.status] ?? only.status}`;
	}
	const parts = sorted.map((row) => `${row.round_number} (${ROUND_STATUS_TEXT[row.status] ?? row.status})`);
	return `Cerrá primero las rondas ${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`
}

// Lo que decide si una ronda pendiente puede iniciar, además de su status.
// Espera un alias r sobre rounds. START_ALLOWED_SQL es la misma regla como
// condición de un WHERE; START_STATE_SQL la expone para explicar el rechazo.
const START_ALLOWED_SQL = `
	NOT EXISTS (SELECT 1 FROM tournaments t WHERE t.id = r.tournament_id AND t.status = 'finished')
	AND NOT EXISTS (${OPEN_PREVIOUS_ROUNDS_SQL})
	AND (
	  NOT EXISTS (SELECT 1 FROM rounds prev WHERE prev.tournament_id = r.tournament_id AND prev.round_number < r.round_number)
	  OR EXISTS (SELECT 1 FROM round_participants rp WHERE rp.round_id = r.id)
	)`;
const START_STATE_SQL = `
	(SELECT t.status FROM tournaments t WHERE t.id = r.tournament_id) AS tournament_status,
	(SELECT json_agg(b) FROM (${OPEN_PREVIOUS_ROUNDS_SQL}) b) AS start_blockers,
	EXISTS (SELECT 1 FROM rounds prev WHERE prev.tournament_id = r.tournament_id AND prev.round_number < r.round_number) AS has_previous,
	EXISTS (SELECT 1 FROM round_participants rp WHERE rp.round_id = r.id) AS has_roster`;

// Motivo por el que una ronda pendiente no puede iniciar, o null si puede. Mismo
// orden de prioridad que ve el admin: lo más fácil de resolver primero no sirve
// si el torneo ya terminó.
function startBlockReason(row) {
	if (row.tournament_status === 'finished') return 'El torneo ya terminó';
	if (row.start_blockers) return describeStartBlock(row.start_blockers);
	// Una ronda siguiente sin roster es de antes de estas reglas (el panel la
	// creaba con POST /rounds): nadie puede entrar, así que no se juega.
	if (row.has_previous && !row.has_roster) {
		return `La ronda ${row.round_number} no tiene participantes: solo la juegan los clasificados de la anterior. Pasalos con "Avanzar a la siguiente ronda" en Progreso del torneo.`;
	}
	return null
}

function generateAccessCode() {
	let code = '';
	for (let position = 0; position < ACCESS_CODE_LENGTH; position += 1) {
		// randomInt, not a modulo of randomBytes: rejection-free and free of
		// the modulo bias that % 32 would introduce.
		code += ACCESS_CODE_ALPHABET[crypto.randomInt(ACCESS_CODE_ALPHABET.length)];
	}
	return code;
}

// Participants retype a code from a printed list or a chat message, so accept
// lowercase, spaces and stray dashes. Codes are stored without separators.
function normalizeAccessCode(raw) {
	return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// An access code is usable when it is unused, its deadline has not passed and,
// if it was minted for a tournament, that tournament has not finished.
const USABLE_ACCESS_CODE_SQL = `
	SELECT id, tournament_id
	FROM access_codes ac
	WHERE ac.code = $1
	  AND ac.status = 'unused'
	  AND (ac.expires_at IS NULL OR ac.expires_at > now())
	  AND (
	    ac.tournament_id IS NULL
	    OR EXISTS (
	      SELECT 1 FROM tournaments t
	      WHERE t.id = ac.tournament_id AND t.status <> 'finished'
	    )
	  )
	FOR UPDATE OF ac`;

// Date no es un header CORS-safelisted: sin exponerlo, el frontend en otro
// origen (desarrollo) no puede leerlo para sincronizar el cronómetro.
// methods explícito: @fastify/cors 11 solo permite GET, HEAD y POST por defecto,
// y en desarrollo (frontend y backend en orígenes distintos) el navegador
// bloqueaba todo PUT y DELETE del panel. En producción es el mismo origen.
fastify.register(cors, {
	origin: allowedOrigins,
	methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'],
	exposedHeaders: ['Date'],
});

// Un valor que Postgres no puede convertir (22P02: "abc" como uuid en /rounds/abc)
// es un error del cliente, no un 500. Todo lo demás sigue al manejador por
// defecto de Fastify, igual que antes.
fastify.setErrorHandler((error, request, reply) => {
	if (error.code === '22P02') {
		request.log.info({ err: error }, 'Valor inválido para Postgres');
		return reply.code(400).send({ error: 'Identificador no válido' });
	}
	// El 413 lo dispara el parser de body de Fastify, antes de que corra cualquier
	// hook: sin esto el admin ve un JSON con un code interno en vez de un motivo.
	if (error.statusCode === 413) {
		request.log.info({ err: error }, 'Cuerpo de request demasiado grande');
		return reply.code(413).send({
			error: `El problema supera los ${MAX_BODY_BYTES / (1024 * 1024)} MB permitidos. `
				+ 'Reducí los casos o partilo en problemas más chicos.',
		});
	}
	throw error
});

// now (ms) sincroniza el reloj de los clientes: el header Date solo tiene
// resolución de un segundo y descuadraba la cuenta regresiva hasta 1 s.
fastify.get('/health', async () => ({ status: 'ok', now: Date.now() }));

fastify.get('/ready', async (request, reply) => {
	try {
		await query('SELECT 1');
		await submissionQueue.getJobCounts();
		const sessions = getSessionStoreStatus();
		if (!sessions.ready) throw new Error('El almacen de sesiones no está listo');
		return { status: 'ready', database: 'ok', redis: 'ok', sessions };
	} catch (error) {
		request.log.error(error, 'Readiness check failed');
		return reply.code(503).send({ status: 'not_ready' });
	}
});

fastify.post('/auth/login', async (request, reply) => {
	const username = String(request.body?.username || '').trim();
	const accessCode = String(request.body?.accessCode || '').trim();
	if (!username || username.length > 128 || !accessCode || accessCode.length > 256) {
		return reply.code(400).send({ error: 'Credenciales inválidas' });
	}
	if (rejectLimitedAuth(request, reply, username)) return;

	// The raw value is tried first so codes minted before normalisation keep
	// working verbatim; the normalized form is the fallback for the short PINs,
	// which participants tend to retype in lowercase.
	const result = await query(
		'SELECT id, username, role FROM users WHERE username = $1 AND (access_code = $2 OR access_code = $3)',
		[username, accessCode, normalizeAccessCode(accessCode)],
	);

	if (result.rowCount === 0) {
		recordAuthFailure(request, username);
		return reply.code(401).send({ error: 'Credenciales inválidas' });
	}

	clearAuthFailuresForRequest(request, username);
	const user = result.rows[0];
	const token = crypto.randomUUID();
	await setSession(token, user);
	return { token, user };
});

fastify.post('/auth/register', async (request, reply) => {
	const username = String(request.body?.username || '').trim();
	const accessCode = normalizeAccessCode(request.body?.accessCode);

	// The minimum is the short-PIN length. The old codes were 22 characters, so
	// the previous floor of 8 would have rejected every code minted here.
	if (username.length < 3 || username.length > 128 || accessCode.length < ACCESS_CODE_LENGTH || accessCode.length > 256) {
		return reply.code(400).send({ error: 'Usuario y código de acceso no válidos' });
	}
	if (rejectLimitedAuth(request, reply, username)) return;

	try {
		const user = await withTransaction(async (client) => {
			const codeResult = await client.query(USABLE_ACCESS_CODE_SQL, [accessCode]);
			if (!codeResult.rowCount) {
				const error = new Error('Código de acceso no disponible');
				error.code = 'ACCESS_CODE_UNAVAILABLE';
				throw error;
			}
			// El nombre no identifica (username ya no es UNIQUE: la identidad es el
			// código), pero el del admin sigue reservado para no confundirlo en el panel.
			const reserved = await client.query(
				"SELECT 1 FROM users WHERE role = 'admin' AND lower(username) = lower($1)",
				[username],
			);
			if (reserved.rowCount) {
				const error = new Error('Ese nombre está reservado. Elegí otro.');
				error.code = 'USERNAME_TAKEN';
				throw error;
			}
			// Dentro de un mismo torneo el nombre no se repite: en la pista, el
			// ranking y la cola del admin dos "Ana" serían indistinguibles. El lock
			// serializa dos altas simultáneas con el mismo nombre en el mismo torneo.
			const { tournament_id: tournamentId } = codeResult.rows[0];
			if (tournamentId) {
				await client.query('SELECT pg_advisory_xact_lock(hashtext($1 || lower($2)))', [tournamentId, username]);
				const taken = await client.query(
					`SELECT 1 FROM access_codes
					 WHERE tournament_id = $1 AND status = 'claimed' AND lower(display_name) = lower($2)`,
					[tournamentId, username],
				);
				if (taken.rowCount) {
					const error = new Error('Ya hay alguien con ese nombre en este torneo. Agregá una inicial o un apellido.');
					error.code = 'USERNAME_TAKEN';
					throw error;
				}
			}

			const userResult = await client.query(
				`INSERT INTO users (username, access_code, role)
				 VALUES ($1, $2, 'participant')
				 RETURNING id, username, role`,
				[username, accessCode],
			);
			await client.query(
				`UPDATE access_codes
				 SET status = 'claimed', claimed_by_user_id = $1, display_name = $2, claimed_at = now()
				 WHERE id = $3`,
				[userResult.rows[0].id, username, codeResult.rows[0].id],
			);
			return userResult.rows[0];
		});

		clearAuthFailuresForRequest(request, username);
		const token = crypto.randomUUID();
		await setSession(token, user);
		return { token, user };
	} catch (error) {
		if (error.code === 'USERNAME_TAKEN') {
			return reply.code(409).send({ error: error.message });
		}
		if (error.code === 'ACCESS_CODE_UNAVAILABLE') {
			recordAuthFailure(request, username);
			return reply.code(409).send({ error: error.message });
		}
		throw error;
	}
});

fastify.post('/auth/logout', async (request) => {
	const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
	if (token) await deleteSession(token);
	return { loggedOut: true };
});

async function requireRole(request, reply, role) {
	const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
	const user = token ? await getSession(token) : null;

	if (!user) {
		reply.code(401).send({ error: 'Sesión requerida' });
		return false;
	}

	if (role && user.role !== role) {
		reply.code(403).send({ error: 'Rol insuficiente' });
		return false;
	}

	request.user = user;
	return true;
}

fastify.post('/tournaments', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { name } = request.body || {};
	const result = await query('INSERT INTO tournaments (name) VALUES ($1) RETURNING *', [name]);
	return reply.code(201).send(result.rows[0]);
});

// Por defecto solo los que no terminaron: es lo que alimenta todos los selectores
// del panel (configurar ronda, progreso, ronda siguiente, códigos), y un torneo
// terminado no admite rondas ni códigos. Los terminados se piden explícitamente
// con ?status=finished, con los conteos que muestra la confirmación de borrado.
// Mismo criterio que /public/rounds/active: status = 'finished'.
fastify.get('/tournaments', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const scope = request.query?.status;
	if (scope === undefined) {
		// played_rounds_count decide si el borrado masivo ofrece la casilla: un
		// torneo abierto con rondas jugadas no se borra (mismo criterio que DELETE).
		const result = await query(
			`SELECT t.*,
			        (SELECT count(*)::int FROM rounds r WHERE r.tournament_id = t.id) AS rounds_count,
			        (SELECT count(*)::int FROM rounds r
			         WHERE r.tournament_id = t.id AND r.status <> 'pending') AS played_rounds_count
			 FROM tournaments t WHERE t.status <> 'finished' ORDER BY t.created_at DESC`,
		);
		return result.rows;
	}
	if (scope !== 'finished') return reply.code(400).send({ error: 'status solo admite finished' });
	const result = await query(
		`SELECT t.*,
		        (SELECT count(*)::int FROM rounds r WHERE r.tournament_id = t.id) AS rounds_count,
		        (SELECT count(*)::int FROM participants p WHERE p.tournament_id = t.id) AS participants_count,
		        (SELECT count(*)::int FROM submissions s JOIN rounds r ON r.id = s.round_id
		         WHERE r.tournament_id = t.id) AS submissions_count,
		        (SELECT count(*)::int FROM participants p
		         WHERE p.tournament_id = t.id
		           AND NOT EXISTS (SELECT 1 FROM participants other
		                           WHERE other.user_id = p.user_id AND other.tournament_id <> t.id)
		        ) AS orphaned_users_count
		 FROM tournaments t WHERE t.status = 'finished' ORDER BY t.created_at DESC`,
	);
	return result.rows;
});

fastify.put('/tournaments/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const name = String(request.body?.name || '').trim();
	if (!name) return reply.code(400).send({ error: 'El nombre es obligatorio' });
	const result = await query('UPDATE tournaments SET name = $1 WHERE id = $2 RETURNING *', [name, request.params.id]);
	return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'Torneo no encontrado' });
});

// Borra un torneo con sus rondas, participantes, envíos y códigos. Solo si
// terminó, o si nunca se jugó ninguna ronda (uno creado por error). Los usuarios
// no se borran: users no cuelga de ningún torneo. Los que quedan sin torneo se
// limpian aparte, revisándolos antes, desde /users/orphans.
fastify.delete('/tournaments/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const outcome = await withTransaction(async (client) => {
		const tournament = await client.query(
			'SELECT id, name, status FROM tournaments WHERE id = $1 FOR UPDATE',
			[request.params.id],
		);
		if (!tournament.rowCount) return null;
		const played = await client.query(
			"SELECT count(*)::int AS n FROM rounds WHERE tournament_id = $1 AND status <> 'pending'",
			[request.params.id],
		);
		if (tournament.rows[0].status !== 'finished' && played.rows[0].n > 0) {
			return { blocked: tournament.rows[0].name };
		}
		// submissions no tiene ON DELETE CASCADE hacia rounds ni participants: sin
		// este paso, el DELETE del torneo choca con la FK de cualquier ronda jugada.
		const submissions = await client.query(
			`DELETE FROM submissions s USING rounds r
			 WHERE r.id = s.round_id AND r.tournament_id = $1`,
			[request.params.id],
		);
		const counts = await client.query(
			`SELECT (SELECT count(*)::int FROM rounds WHERE tournament_id = $1) AS rounds,
			        (SELECT count(*)::int FROM participants WHERE tournament_id = $1) AS participants`,
			[request.params.id],
		);
		await client.query('DELETE FROM tournaments WHERE id = $1', [request.params.id]);
		return { ...counts.rows[0], submissions: submissions.rowCount };
	});
	if (!outcome) return reply.code(404).send({ error: 'Torneo no encontrado' });
	if (outcome.blocked) {
		return reply.code(409).send({
			error: `"${outcome.blocked}" no terminó y ya se jugaron rondas. Finalizalo antes de borrarlo.`,
		});
	}
	return { deleted: true, ...outcome };
});

// Ids de un borrado masivo: de 1 a 500 uuids, sin repetidos. null si no sirve.
function parseIdList(ids) {
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500
		|| !ids.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))) {
		return null;
	}
	return [...new Set(ids.map((id) => id.toLowerCase()))]
}

// Un torneo se borra si terminó o si nunca se jugó una ronda. Es el criterio de
// DELETE /tournaments/:id, repetido en el WHERE del borrado masivo.
const TOURNAMENT_DELETABLE_SQL = `
	(t.status = 'finished'
	 OR NOT EXISTS (SELECT 1 FROM rounds r WHERE r.tournament_id = t.id AND r.status <> 'pending'))`;

// Qué se llevaría el borrado de cada torneo. Lo usan la vista previa y el
// borrado, así el admin confirma sobre los mismos números que se ejecutan. Con
// lock, rondas y torneos quedan tomados hasta el COMMIT, en el orden de
// closeRound (ronda, después torneo): ningún /start ni /next se cuela entre la
// decisión y el DELETE.
async function classifyTournaments(client, ids, { lock = false } = {}) {
	if (lock) {
		await client.query('SELECT id FROM rounds WHERE tournament_id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
		await client.query('SELECT id FROM tournaments WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
	}
	const result = await client.query(
		`SELECT t.id, t.name, t.status, ${TOURNAMENT_DELETABLE_SQL} AS deletable,
		        (SELECT count(*)::int FROM rounds r WHERE r.tournament_id = t.id) AS rounds,
		        (SELECT count(*)::int FROM rounds r
		         WHERE r.tournament_id = t.id AND r.status IN ('active', 'closing')) AS live_rounds,
		        (SELECT count(*)::int FROM participants p WHERE p.tournament_id = t.id) AS participants,
		        (SELECT count(*)::int FROM access_codes ac WHERE ac.tournament_id = t.id) AS access_codes,
		        (SELECT count(*)::int FROM submissions s JOIN rounds r ON r.id = s.round_id
		         WHERE r.tournament_id = t.id) AS submissions,
		        (SELECT count(*)::int FROM participants p
		         WHERE p.tournament_id = t.id
		           AND NOT EXISTS (SELECT 1 FROM participants other
		                           WHERE other.user_id = p.user_id AND other.tournament_id <> ALL($1::uuid[]))
		        ) AS orphaned_users
		 FROM tournaments t WHERE t.id = ANY($1::uuid[]) ORDER BY t.created_at DESC`,
		[ids],
	);
	const found = new Set(result.rows.map((row) => row.id));
	const deletable = [];
	const blocked = [];
	for (const { deletable: ok, ...row } of result.rows) {
		if (ok) {
			deletable.push(row);
			continue;
		}
		const why = row.live_rounds > 0 ? 'tiene una ronda en curso' : 'no terminó y ya se jugaron rondas';
		blocked.push({ ...row, reason: `"${row.name}" ${why}. Finalizalo antes de borrarlo.` });
	}
	const totals = { tournaments: deletable.length, rounds: 0, participants: 0, access_codes: 0, submissions: 0, orphaned_users: 0 };
	for (const row of deletable) {
		for (const key of ['rounds', 'participants', 'access_codes', 'submissions', 'orphaned_users']) totals[key] += row[key];
	}
	return { deletable, blocked, missing: ids.filter((id) => !found.has(id)), totals };
}

// Vista previa del borrado masivo: no borra nada. orphaned_users cuenta a los
// que no juegan ningún torneo fuera de la selección: no se borran, quedan para
// /users/orphans.
fastify.post('/tournaments/delete-preview', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const ids = parseIdList(request.body?.ids);
	if (!ids) return reply.code(400).send({ error: 'ids debe ser una lista de 1 a 500 ids de torneo' });
	return classifyTournaments({ query }, ids);
});

// Borra los torneos borrables de la lista en una sola transacción: o se van
// todos, o ninguno. Los bloqueados no se tocan y vuelven en skipped con el
// motivo. users no se toca: participants no cascadea hacia users.
fastify.delete('/tournaments', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const ids = parseIdList(request.body?.ids);
	if (!ids) return reply.code(400).send({ error: 'ids debe ser una lista de 1 a 500 ids de torneo' });
	const plan = await withTransaction(async (client) => {
		const classified = await classifyTournaments(client, ids, { lock: true });
		const doomed = classified.deletable.map((row) => row.id);
		if (!doomed.length) return classified;
		// submissions no cascadea desde rounds ni participants (ver DELETE /tournaments/:id).
		await client.query(
			`DELETE FROM submissions s USING rounds r
			 WHERE r.id = s.round_id AND r.tournament_id = ANY($1::uuid[])`,
			[doomed],
		);
		const deleted = await client.query(
			`DELETE FROM tournaments t WHERE t.id = ANY($1::uuid[]) AND ${TOURNAMENT_DELETABLE_SQL} RETURNING t.id`,
			[doomed],
		);
		// Con las filas tomadas no debería pasar; si pasa, ROLLBACK y nada a medias.
		if (deleted.rowCount !== doomed.length) {
			throw new Error(`Borrado de torneos incompleto: ${deleted.rowCount} de ${doomed.length}`);
		}
		return classified;
	});
	return { deleted: plan.deletable, skipped: plan.blocked, missing: plan.missing, totals: plan.totals };
});

// Un usuario huérfano es un participante que no está en ningún torneo: el suyo
// se borró. Nunca el admin: role = 'participant' va en el WHERE de la lista y
// del borrado, y además un trigger de schema.sql rechaza cualquier DELETE de un
// admin. Se excluye a quien se registró con un código de un torneo que sigue
// abierto, o hace menos de un día: todavía no entró a su primera ronda (el
// registro es antes del inicio) y borrarlo lo dejaría con una sesión que no
// puede inscribirse. Espera un alias u sobre users.
const ORPHAN_USER_SQL = `
	u.role = 'participant'
	AND NOT EXISTS (SELECT 1 FROM participants p WHERE p.user_id = u.id)
	AND NOT EXISTS (
	  SELECT 1 FROM access_codes ac JOIN tournaments t ON t.id = ac.tournament_id
	  WHERE ac.claimed_by_user_id = u.id AND t.status <> 'finished'
	)
	AND u.created_at < now() - interval '1 day'`;

// La lista para revisar antes de borrar. El código se muestra porque el nombre
// ya no identifica: puede haber varios "Juan".
fastify.get('/users/orphans', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query(
		`SELECT u.id, u.username, u.access_code, u.created_at
		 FROM users u WHERE ${ORPHAN_USER_SQL}
		 ORDER BY u.created_at, u.username LIMIT 1000`,
	);
	return result.rows;
});

// Borra solo los ids que el admin revisó, y de esos solo los que siguen siendo
// huérfanos: el criterio se vuelve a evaluar con las filas bloqueadas. Nunca un
// DELETE a ciegas de "todos los huérfanos".
fastify.delete('/users/orphans', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const ids = request.body?.ids;
	if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000
		|| !ids.every((id) => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id))) {
		return reply.code(400).send({ error: 'ids debe ser una lista de 1 a 1000 ids de usuario' });
	}
	const deleted = await withTransaction(async (client) => {
		// FOR UPDATE choca con el KEY SHARE de la FK de participants: nadie se
		// inscribe con uno de estos usuarios mientras se borra.
		const doomed = await client.query(
			`SELECT u.id FROM users u WHERE u.id = ANY($1::uuid[]) AND ${ORPHAN_USER_SQL} FOR UPDATE`,
			[ids],
		);
		const doomedIds = doomed.rows.map((row) => row.id);
		if (!doomedIds.length) return [];
		// access_codes.claimed_by_user_id no tiene ON DELETE: el código queda
		// canjeado y con su display_name, sin el vínculo al usuario.
		await client.query(
			'UPDATE access_codes SET claimed_by_user_id = NULL WHERE claimed_by_user_id = ANY($1::uuid[])',
			[doomedIds],
		);
		const result = await client.query(
			`DELETE FROM users u WHERE u.id = ANY($1::uuid[]) AND ${ORPHAN_USER_SQL} RETURNING u.id, u.username`,
			[doomedIds],
		);
		return result.rows;
	});
	return { deleted: deleted.length, users: deleted };
});

fastify.get('/problems', async () => {
	const result = await query('SELECT id, name, difficulty, created_at FROM problems ORDER BY created_at DESC');
	return result.rows;
});

// Deja cada caso con la forma { stdin, expected, is_sample }. is_sample solo es
// true si el admin lo marcó explícitamente: un caso nunca se vuelve público por
// omisión.
function normalizeTestCases(testCases) {
	return testCases.map((testCase) => ({
		stdin: testCase?.stdin,
		expected: testCase?.expected,
		is_sample: testCase?.is_sample === true,
	}))
}

// Validación de PUT /rounds/:id que no necesita la base. null = no cambia.
const DIFFICULTIES = ['easy', 'medium', 'hard'];

function validateRoundEdit({ problemId, capacity, timeLimitSeconds, difficulty = null }) {
	if (problemId !== null && (typeof problemId !== 'string' || !/^[0-9a-f-]{36}$/i.test(problemId))) {
		return 'problemId no es válido';
	}
	if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
		return 'capacity debe ser un entero positivo';
	}
	if (timeLimitSeconds !== null
		&& (!Number.isInteger(timeLimitSeconds) || timeLimitSeconds < 10 || timeLimitSeconds > 86400)) {
		return 'timeLimitSeconds debe estar entre 10 y 86400';
	}
	if (difficulty !== null && !DIFFICULTIES.includes(difficulty)) {
		return 'difficulty debe ser easy, medium o hard';
	}
	if (problemId === null && capacity === null && timeLimitSeconds === null && difficulty === null) {
		return 'Indicá al menos problemId, capacity, timeLimitSeconds o difficulty';
	}
	return null
}

// Plan de rondas de PUT /tournaments/:id/plan, sin la base. Cada ronda trae su
// número, dificultad, problema, cupo y tiempo. null = válido.
function validateRoundPlan(rounds) {
	if (!Array.isArray(rounds) || rounds.length === 0) return 'El plan no tiene rondas';
	if (rounds.length > 50) return 'El plan admite hasta 50 rondas';
	const numbers = new Set();
	for (const round of rounds) {
		const number = round?.round_number;
		if (!Number.isInteger(number) || number < 1) return 'round_number debe ser un entero desde 1';
		if (numbers.has(number)) return `La ronda ${number} está repetida en el plan`;
		numbers.add(number);
		if (!DIFFICULTIES.includes(round.difficulty)) return `Ronda ${number}: difficulty debe ser easy, medium o hard`;
		if (typeof round.problemId !== 'string' || !/^[0-9a-f-]{36}$/i.test(round.problemId)) {
			return `Ronda ${number}: elegí un problema`;
		}
		if (!Number.isInteger(round.capacity) || round.capacity < 1) {
			return `Ronda ${number}: el cupo debe ser un entero positivo`;
		}
		if (!Number.isInteger(round.timeLimitSeconds) || round.timeLimitSeconds < 10 || round.timeLimitSeconds > 86400) {
			return `Ronda ${number}: el tiempo debe estar entre 10 segundos y 24 horas`;
		}
	}
	return null
}

fastify.post('/problems', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { name, statement, difficulty = 'easy', testCases } = request.body || {};
	if (!name || !statement) {
		return reply.code(400).send({ error: 'name y statement son obligatorios' });
	}
	if (!Array.isArray(testCases) || testCases.length === 0) {
		return reply.code(400).send({ error: 'testCases debe ser una lista con al menos un caso' });
	}
	if (testCases.length > 100) {
		return reply.code(400).send({ error: 'testCases admite como máximo 100 casos' });
	}
	const invalidIndex = testCases.findIndex((testCase) => typeof testCase?.stdin !== 'string'
		|| typeof testCase?.expected !== 'string');
	if (invalidIndex !== -1) {
		return reply.code(400).send({ error: `El caso ${invalidIndex + 1} debe tener stdin y expected como texto` });
	}
	const result = await query(
		`INSERT INTO problems (name, statement, difficulty, test_cases)
		 VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
		[name, statement, difficulty, JSON.stringify(normalizeTestCases(testCases))],
	);
	return reply.code(201).send(result.rows[0]);
});

fastify.get('/problems/:id', async (request, reply) => {
	const result = await query(
		'SELECT id, name, difficulty, created_at FROM problems WHERE id = $1',
		[request.params.id],
	);
	return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'Problema no encontrado' });
});

// El problema completo para el formulario de edición: casos con is_sample y las
// rondas que lo usan. Endpoint aparte de GET /problems/:id, que no pide sesión y
// por eso nunca devuelve casos.
fastify.get('/problems/:id/full', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(404).send({ error: 'Problema no encontrado' });
	const problem = await query(
		'SELECT id, name, statement, difficulty, test_cases, created_at FROM problems WHERE id = $1',
		[request.params.id],
	);
	if (!problem.rowCount) return reply.code(404).send({ error: 'Problema no encontrado' });
	const rounds = await query(
		`SELECT r.id, r.round_number, r.status, t.name AS tournament_name, t.status AS tournament_status
		 FROM rounds r JOIN tournaments t ON t.id = r.tournament_id
		 WHERE r.problem_id = $1 ORDER BY t.created_at, r.round_number`,
		[request.params.id],
	);
	return { ...problem.rows[0], rounds: rounds.rows };
});

fastify.put('/problems/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { name, statement, difficulty = 'easy', testCases = [] } = request.body || {};
	if (!name || !statement || !Array.isArray(testCases)) {
		return reply.code(400).send({ error: 'name, statement y testCases son obligatorios' });
	}
	// Mismas reglas que POST /problems: sin esto, un PUT sin casos dejaba el
	// problema vacío y todo envío terminaba en no_test_cases.
	if (testCases.length === 0 || testCases.length > 100) {
		return reply.code(400).send({ error: 'testCases debe tener entre 1 y 100 casos' });
	}
	const invalidIndex = testCases.findIndex((testCase) => typeof testCase?.stdin !== 'string'
		|| typeof testCase?.expected !== 'string');
	if (invalidIndex !== -1) {
		return reply.code(400).send({ error: `El caso ${invalidIndex + 1} debe tener stdin y expected como texto` });
	}
	const testCasesJson = JSON.stringify(normalizeTestCases(testCases));
	const outcome = await withTransaction(async (client) => {
		const current = await client.query(
			// NO KEY: no frena el KEY SHARE que toman las FK de rounds al insertar.
			'SELECT test_cases <> $2::jsonb AS cases_changed FROM problems WHERE id = $1 FOR NO KEY UPDATE',
			[request.params.id, testCasesJson],
		);
		if (!current.rowCount) return null;
		if (current.rows[0].cases_changed) {
			// Los casos se leen cuando corre el job (loadTestCases), no cuando se
			// envía: cambiarlos con la ronda en juego juzgaría envíos de la misma
			// ronda contra casos distintos. 'closing' todavía no cerró. El FOR
			// UPDATE OF r hace esperar a un /start simultáneo hasta que esto termine.
			const rounds = await client.query(
				`SELECT r.round_number, r.status, t.name AS tournament_name
				 FROM rounds r JOIN tournaments t ON t.id = r.tournament_id
				 WHERE r.problem_id = $1 ORDER BY r.round_number FOR UPDATE OF r`,
				[request.params.id],
			);
			const blocking = rounds.rows.find((row) => row.status === 'active' || row.status === 'closing');
			if (blocking) return { blocking };
		}
		// Nombre, enunciado y dificultad no cambian el veredicto de nadie: se
		// pueden editar con la ronda en juego.
		const updated = await client.query(
			`UPDATE problems SET name = $1, statement = $2, difficulty = $3, test_cases = $4::jsonb
			 WHERE id = $5 RETURNING *`,
			[name, statement, difficulty, testCasesJson, request.params.id],
		);
		return { problem: updated.rows[0] };
	});
	if (!outcome) return reply.code(404).send({ error: 'Problema no encontrado' });
	if (outcome.blocking) {
		const { round_number: roundNumber, status, tournament_name: tournamentName } = outcome.blocking;
		return reply.code(409).send({
			error: `No se pueden cambiar los casos: la ronda ${roundNumber} de "${tournamentName}" está ${ROUND_STATUS_TEXT[status]} con este problema. Nombre, enunciado y dificultad sí se pueden guardar; los casos, cuando la ronda cierre.`,
		});
	}
	return outcome.problem;
});

// Un problema se borra si ninguna ronda de un torneo sin terminar lo usa. Las
// rondas de torneos terminados sobreviven: la FK es ON DELETE SET NULL, y antes
// de borrar se copia el nombre a rounds.problem_name para que el historial diga
// qué se jugó. Nunca CASCADE: se llevaría las rondas y sus envíos.
fastify.delete('/problems/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const outcome = await withTransaction(async (client) => {
		// FOR UPDATE choca con el KEY SHARE que toma la FK al crear o editar una
		// ronda con este problema: nadie lo puede elegir mientras se decide.
		const problem = await client.query('SELECT id, name FROM problems WHERE id = $1 FOR UPDATE', [request.params.id]);
		if (!problem.rowCount) return null;
		const blocking = await client.query(
			`SELECT r.round_number, r.status, t.name AS tournament_name
			 FROM rounds r JOIN tournaments t ON t.id = r.tournament_id
			 WHERE r.problem_id = $1 AND t.status <> 'finished'
			 ORDER BY t.created_at, r.round_number`,
			[request.params.id],
		);
		if (blocking.rowCount) return { blocking: blocking.rows };
		const kept = await client.query(
			'UPDATE rounds SET problem_name = $2 WHERE problem_id = $1',
			[request.params.id, problem.rows[0].name],
		);
		await client.query('DELETE FROM problems WHERE id = $1', [request.params.id]);
		return { roundsKept: kept.rowCount };
	});
	if (!outcome) return reply.code(404).send({ error: 'Problema no encontrado' });
	if (outcome.blocking) {
		return reply.code(409).send({
			error: `No se puede borrar: ${problemBlockReason(outcome.blocking)}`,
			blocking: outcome.blocking,
		});
	}
	return { deleted: true, roundsKept: outcome.roundsKept };
});

// Por qué no se puede borrar un problema: las rondas de torneos abiertos que lo usan.
function problemBlockReason(blocking) {
	const list = blocking
		.map((row) => `ronda ${row.round_number} de "${row.tournament_name}" (${ROUND_STATUS_TEXT[row.status] ?? row.status})`)
		.join(', ');
	// PUT /rounds/:id solo edita pendientes: una ronda ya jugada libera el
	// problema recién cuando su torneo termina.
	const hint = blocking.every((row) => row.status === 'pending')
		? 'Cambiale el problema a esa ronda (Editar, en Progreso del torneo) y volvé a intentar.'
		: 'Una ronda ya jugada lo libera cuando su torneo termine; una pendiente, cambiándole el problema.';
	return `lo usa${blocking.length === 1 ? '' : 'n'} ${list}, de un torneo que no terminó. ${hint}`
}

// Mismo criterio que DELETE /problems/:id, para el WHERE del borrado masivo:
// ninguna ronda de un torneo sin terminar usa el problema.
const PROBLEM_DELETABLE_SQL = `
	NOT EXISTS (SELECT 1 FROM rounds r JOIN tournaments t ON t.id = r.tournament_id
	            WHERE r.problem_id = p.id AND t.status <> 'finished')`;

// Separa la selección en los que se borran y los que no, con el motivo. Lo usan
// la vista previa y el borrado. Con lock, el FOR UPDATE choca con el KEY SHARE
// de la FK de rounds: nadie crea ni edita una ronda con estos problemas hasta
// el COMMIT, igual que en DELETE /problems/:id.
async function classifyProblems(client, ids, { lock = false } = {}) {
	const problems = await client.query(
		`SELECT id, name FROM problems WHERE id = ANY($1::uuid[]) ORDER BY created_at DESC${lock ? ' FOR UPDATE' : ''}`,
		[ids],
	);
	const rounds = await client.query(
		`SELECT r.problem_id, r.round_number, r.status, t.name AS tournament_name, t.status AS tournament_status
		 FROM rounds r JOIN tournaments t ON t.id = r.tournament_id
		 WHERE r.problem_id = ANY($1::uuid[]) ORDER BY t.created_at, r.round_number`,
		[ids],
	);
	const deletable = [];
	const blocked = [];
	for (const problem of problems.rows) {
		const own = rounds.rows.filter((row) => row.problem_id === problem.id);
		const blocking = own
			.filter((row) => row.tournament_status !== 'finished')
			.map(({ round_number, status, tournament_name }) => ({ round_number, status, tournament_name }));
		if (blocking.length) {
			blocked.push({ ...problem, blocking, reason: `"${problem.name}": ${problemBlockReason(blocking)}` });
		} else {
			// Rondas de torneos terminados: quedan con problem_id NULL y el nombre.
			deletable.push({ ...problem, rounds_kept: own.length });
		}
	}
	const found = new Set(problems.rows.map((row) => row.id));
	return { deletable, blocked, missing: ids.filter((id) => !found.has(id)) };
}

// Vista previa: no borra nada.
fastify.post('/problems/delete-preview', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const ids = parseIdList(request.body?.ids);
	if (!ids) return reply.code(400).send({ error: 'ids debe ser una lista de 1 a 500 ids de problema' });
	return classifyProblems({ query }, ids);
});

// Borra los problemas borrables de la lista y deja los bloqueados, en una sola
// transacción: los borrables se van todos o ninguno. El panel manda solo los
// que la vista previa dio por borrables; si algo cambió desde entonces, vuelve
// en skipped con su motivo y no se borra.
fastify.delete('/problems', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const ids = parseIdList(request.body?.ids);
	if (!ids) return reply.code(400).send({ error: 'ids debe ser una lista de 1 a 500 ids de problema' });
	const plan = await withTransaction(async (client) => {
		const classified = await classifyProblems(client, ids, { lock: true });
		const doomed = classified.deletable.map((row) => row.id);
		if (!doomed.length) return classified;
		await client.query(
			`UPDATE rounds r SET problem_name = p.name FROM problems p
			 WHERE p.id = r.problem_id AND p.id = ANY($1::uuid[])`,
			[doomed],
		);
		const deleted = await client.query(
			`DELETE FROM problems p WHERE p.id = ANY($1::uuid[]) AND ${PROBLEM_DELETABLE_SQL} RETURNING p.id`,
			[doomed],
		);
		if (deleted.rowCount !== doomed.length) {
			throw new Error(`Borrado de problemas incompleto: ${deleted.rowCount} de ${doomed.length}`);
		}
		return classified;
	});
	return { deleted: plan.deletable, skipped: plan.blocked, missing: plan.missing };
});

fastify.post('/tournaments/:id/participants', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { userId, displayName } = request.body || {};
	const result = await query(
		`INSERT INTO participants (tournament_id, user_id, display_name)
		 VALUES ($1, $2, $3) RETURNING *`,
		[request.params.id, userId, displayName],
	);
	return reply.code(201).send(result.rows[0]);
});

// Un participante está en una ronda si figura en su roster y sigue activo en el
// torneo. Es el único criterio para entrar: lo usan el join HTTP y el socket
// (canAccessSocketRound), así nadie entra por un lado y queda afuera del otro.
async function roundMember(roundId, userId) {
	const result = await query(
		`SELECT p.* FROM round_participants rp
		 JOIN participants p ON p.id = rp.participant_id
		 WHERE rp.round_id = $1 AND p.user_id = $2 AND p.status = 'active'`,
		[roundId, userId],
	);
	return result.rows[0] || null
}

// Si el participante ya está en el torneo de esta ronda, con el personaje que
// eligió. El navegador no alcanza para saberlo: guardaba "ya eligió" por nombre
// de usuario para siempre, y otro torneo (u otra persona con el mismo nombre en
// el mismo navegador) se salteaba la elección y entraba con un personaje ajeno.
fastify.get('/rounds/:id/me', async (request, reply) => {
	if (!(await requireRole(request, reply, 'participant'))) return;
	const result = await query(
		`SELECT EXISTS (
		   SELECT 1 FROM rounds prev
		   WHERE prev.tournament_id = r.tournament_id AND prev.round_number < r.round_number
		 ) AS has_previous,
		 (SELECT json_build_object('id', p.id, 'character', p.character, 'status', p.status)
		  FROM participants p WHERE p.tournament_id = r.tournament_id AND p.user_id = $2) AS participant
		 FROM rounds r WHERE r.id = $1`,
		[request.params.id, request.user.id],
	);
	if (!result.rowCount) return reply.code(404).send({ error: 'La ronda no existe' });
	return result.rows[0]
});

fastify.post('/rounds/:id/participants/join', async (request, reply) => {
	if (!(await requireRole(request, reply, 'participant'))) return;
	const round = await query(
		`SELECT r.*, EXISTS (
		   SELECT 1 FROM rounds prev
		   WHERE prev.tournament_id = r.tournament_id AND prev.round_number < r.round_number
		 ) AS has_previous,
		 (SELECT t.status FROM tournaments t WHERE t.id = r.tournament_id) AS tournament_status
		 FROM rounds r WHERE r.id = $1 AND r.status IN ('pending', 'active')`,
		[request.params.id],
	);
	if (!round.rowCount) return reply.code(409).send({ error: 'La ronda no está disponible' });
	// Una ronda que quedó pendiente en un torneo terminado no se juega nunca
	// (/start la rechaza): inscribirse ahí no lleva a ningún lado.
	if (round.rows[0].tournament_status === 'finished') return reply.code(409).send({ error: 'El torneo ya terminó' });
	// Las rondas siguientes no admiten inscripción: su roster lo armó
	// POST /rounds/:id/next con los clasificados. Antes se miraba solo
	// participants.status, y alguien del torneo que nunca jugó la ronda anterior
	// seguía 'active' y entraba igual.
	if (round.rows[0].has_previous) {
		const member = await roundMember(request.params.id, request.user.id);
		if (!member) {
			return reply.code(403).send({
				error: `No estás en la ronda ${round.rows[0].round_number}: solo juegan los clasificados de la ronda anterior`,
			});
		}
		return member;
	}
	// Primera ronda del torneo: el participante se inscribe solo.
	const displayName = request.body?.displayName || request.user.username;
	// Fuera de rango se guarda 0 en vez de rechazar: un personaje mal formado no
	// puede impedir la entrada a la ronda.
	const requested = Number(request.body?.character);
	const character = Number.isInteger(requested) && requested >= 0 && requested < CHARACTER_COUNT ? requested : 0;
	// character no se actualiza en el conflicto: se fija en la primera
	// inscripción al torneo y las rondas siguientes lo heredan.
	const participant = await query(
		`INSERT INTO participants (tournament_id, user_id, display_name, character)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (tournament_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name
		 RETURNING *`,
		[round.rows[0].tournament_id, request.user.id, displayName, character],
	);
	// El upsert no toca status: un eliminado sigue eliminado. Sin este corte
	// entraría a la ronda siguiente y closeRound lo rankearía contra los activos.
	if (participant.rows[0].status !== 'active') {
		return reply.code(403).send({ error: 'Ya no participas en este torneo' });
	}
	const joined = await query(
		`INSERT INTO round_participants (round_id, participant_id)
		 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		[request.params.id, participant.rows[0].id],
	);
	// Solo al inscribirse por primera vez: la pista y el ranking lo muestran sin
	// esperar a que envíe código.
	if (joined.rowCount) {
		fastify.io?.emit('participant:joined', {
			round_id: request.params.id,
			participant_id: participant.rows[0].id,
			name: participant.rows[0].display_name,
		});
	}
	return participant.rows[0];
});

fastify.post('/tournaments/:id/start', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query(
		"UPDATE tournaments SET status = 'active' WHERE id = $1 RETURNING *",
		[request.params.id],
	);
	return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'Torneo no encontrado' });
});

// Invalidates every still-unused code of a tournament. Called from the places
// where a tournament can end, so no scheduled job is involved: the codes are
// dead in the same transaction that ends the event.
async function expireTournamentAccessCodes(client, tournamentId) {
	const { rows } = await client.query(
		`UPDATE access_codes SET status = 'expired'
		 WHERE tournament_id = $1 AND status = 'unused' RETURNING id`,
		[tournamentId],
	);
	return rows.length;
}

fastify.post('/access-codes/generate', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const count = Math.min(Math.max(Number(request.body?.count || 1), 1), ACCESS_CODE_MAX_COUNT);
	const tournamentId = request.body?.tournamentId || null;
	const ttlMinutes = request.body?.ttlMinutes === undefined || request.body?.ttlMinutes === null
		? null
		: Math.min(Math.max(Number(request.body.ttlMinutes), 1), 60 * 24 * 30);

	if (tournamentId) {
		const tournament = await query('SELECT id, status FROM tournaments WHERE id = $1', [tournamentId]);
		if (!tournament.rowCount) {
			return reply.code(404).send({ error: 'Torneo no encontrado' });
		}
		if (tournament.rows[0].status === 'finished') {
			return reply.code(409).send({ error: 'El torneo ya terminó; no se pueden generar códigos' });
		}
	}

	// Retry on the unique constraint rather than pre-checking: two admins
	// generating at the same time can legitimately collide, and only the
	// constraint is authoritative.
	const expiresAt = ttlMinutes === null
		? null
		: new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
	const codes = [];
	for (let attempt = 0; attempt < count; attempt += 1) {
		for (let retry = 0; retry < 5; retry += 1) {
			const code = generateAccessCode();
			try {
				const result = await query(
					`INSERT INTO access_codes (code, tournament_id, expires_at)
					 VALUES ($1, $2, $3) RETURNING code, tournament_id, expires_at`,
					[code, tournamentId, expiresAt],
				);
				codes.push(result.rows[0]);
				break;
			} catch (error) {
				if (error.code !== '23505') throw error;
			}
		}
	}
	return reply.code(201).send({ codes });
});

fastify.get('/access-codes', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const tournamentId = request.query?.tournamentId || null;
	const result = await query(
		`SELECT ac.id, ac.code, ac.status, ac.display_name, ac.claimed_at, ac.created_at,
		        ac.tournament_id, ac.expires_at, t.name AS tournament_name
		 FROM access_codes ac
		 LEFT JOIN tournaments t ON t.id = ac.tournament_id
		 WHERE ($1::uuid IS NULL OR ac.tournament_id = $1)
		   -- Los invalidados y los vencidos sin usar ya no sirven: no se listan.
		   AND ac.status <> 'expired'
		   AND NOT (ac.status = 'unused' AND ac.expires_at IS NOT NULL AND ac.expires_at <= now())
		 ORDER BY ac.created_at DESC
		 LIMIT 500`,
		[tournamentId],
	);
	return result.rows;
});

// Bulk revoke. The explicit escape hatch for when an event is called off
// without reaching a natural finish.
fastify.post('/access-codes/revoke', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { tournamentId, codes } = request.body || {};
	const conditions = ["status = 'unused'"];
	const values = [];
	if (tournamentId) {
		values.push(tournamentId);
		conditions.push(`tournament_id = $${values.length}`);
	}
	if (Array.isArray(codes) && codes.length) {
		values.push(codes);
		conditions.push(`code = ANY($${values.length}::text[])`);
	}
	if (values.length === 0) {
		return reply.code(400).send({ error: 'Indica tournamentId o codes para revocar' });
	}
	const result = await query(
		`UPDATE access_codes SET status = 'expired' WHERE ${conditions.join(' AND ')} RETURNING code`,
		values,
	);
	return { revoked: result.rowCount, codes: result.rows.map((row) => row.code) };
});

fastify.post('/tournaments/:id/finish', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await withTransaction(async (client) => {
		const finished = await client.query(
			"UPDATE tournaments SET status = 'finished' WHERE id = $1 RETURNING *",
			[request.params.id],
		);
		if (!finished.rowCount) return null;
		const expired = await expireTournamentAccessCodes(client, request.params.id);
		return { tournament: finished.rows[0], expiredAccessCodes: expired };
	});
	if (!result) return reply.code(404).send({ error: 'Torneo no encontrado' });
	fastify.io?.emit('ceremony:update', { tournament_id: request.params.id });
	return result;
});

// Ceremonia de premios (awards.js). Los premios se calculan con lo guardado; el
// ganador de cada uno viaja solo cuando ya se mostró, así nadie se adelanta.
async function loadCeremony(tournamentId) {
	const tournament = await query(
		`SELECT id, name, status, ceremony_step, ceremony_updated_at FROM tournaments WHERE id = $1`,
		[tournamentId],
	);
	if (!tournament.rowCount || tournament.rows[0].status !== 'finished') return null;
	const rounds = await query(
		`SELECT r.id, r.round_number, r.capacity,
		        COALESCE(r.starts_at, r.started_at) AS started_at,
		        LEAST(COALESCE(r.ends_at, now()),
		              COALESCE((SELECT max(s.submitted_at) FROM submissions s WHERE s.round_id = r.id), now())) AS ended_at
		 FROM rounds r WHERE r.tournament_id = $1 AND r.status = 'closed' AND r.started_at IS NOT NULL
		 ORDER BY r.round_number`,
		[tournamentId],
	);
	const rows = await query(
		`SELECT rp.round_id, rp.participant_id, p.display_name, p.character, rp.final_rank,
		        rp.final_status, rp.solved_at, rp.failed_attempts_count
		 FROM round_participants rp
		 JOIN participants p ON p.id = rp.participant_id
		 JOIN rounds r ON r.id = rp.round_id
		 WHERE r.tournament_id = $1 AND rp.final_rank IS NOT NULL`,
		[tournamentId],
	);
	const submissions = await query(
		`SELECT s.participant_id, r.round_number, s.submitted_at, s.verdict,
		        s.test_cases_passed AS passed, s.test_cases_total AS total, s.exec_ms
		 FROM submissions s JOIN rounds r ON r.id = s.round_id
		 WHERE r.tournament_id = $1
		   AND s.verdict NOT IN ('queued', 'queue_error', 'judge_error', 'round_unavailable')`,
		[tournamentId],
	);
	const awards = computeAwards(
		rounds.rows.map((round) => ({
			...round,
			rows: rows.rows.filter((row) => row.round_id === round.id),
		})),
		submissions.rows.map((sub) => ({ ...sub, verdict: sub.verdict === 'accepted' ? 'accepted' : 'rejected' })),
	);
	const winner = await query(
		`SELECT id AS participant_id, display_name, character FROM participants
		 WHERE tournament_id = $1 AND status = 'winner' LIMIT 1`,
		[tournamentId],
	);
	const row = tournament.rows[0];
	const step = row.ceremony_step;
	return {
		tournament: { id: row.id, name: row.name },
		// null = pantalla del ganador, 0 = presentación, 1..N = premio, N + 1 = fin.
		step,
		updated_at: row.ceremony_updated_at,
		champion: winner.rows[0] ?? null,
		awards: awards.map((award, index) => (step !== null && index < step
			? award
			: { id: award.id, title: award.title, description: award.description })),
	};
}

// Pista y participantes: la ceremonia del último torneo, si ya terminó.
fastify.get('/public/ceremony', async () => {
	const latest = await query('SELECT id FROM tournaments ORDER BY created_at DESC LIMIT 1');
	if (!latest.rowCount) return null;
	return loadCeremony(latest.rows[0].id);
});

fastify.get('/tournaments/:id/ceremony', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const ceremony = await loadCeremony(request.params.id);
	if (!ceremony) return reply.code(409).send({ error: 'El torneo todavía no terminó' });
	return ceremony;
});

// Avanza un paso: ganador -> presentación -> cada premio -> fin.
fastify.post('/tournaments/:id/ceremony/next', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const ceremony = await loadCeremony(request.params.id);
	if (!ceremony) return reply.code(409).send({ error: 'El torneo todavía no terminó' });
	const last = ceremony.awards.length + 1;
	const updated = await query(
		`UPDATE tournaments SET ceremony_step = COALESCE(ceremony_step, -1) + 1, ceremony_updated_at = now()
		 WHERE id = $1 AND COALESCE(ceremony_step, -1) < $2 RETURNING ceremony_step`,
		[request.params.id, last],
	);
	if (!updated.rowCount) return reply.code(409).send({ error: 'La ceremonia ya terminó' });
	fastify.io?.emit('ceremony:update', { tournament_id: request.params.id });
	return loadCeremony(request.params.id);
});

// Vuelve a la pantalla del ganador (para repetir la ceremonia o probarla).
fastify.post('/tournaments/:id/ceremony/reset', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const updated = await query(
		`UPDATE tournaments SET ceremony_step = NULL, ceremony_updated_at = now()
		 WHERE id = $1 AND status = 'finished' RETURNING id`,
		[request.params.id],
	);
	if (!updated.rowCount) return reply.code(409).send({ error: 'El torneo todavía no terminó' });
	fastify.io?.emit('ceremony:update', { tournament_id: request.params.id });
	return loadCeremony(request.params.id);
});

fastify.post('/access-codes/:code/claim', async (request, reply) => {
	if (!(await requireRole(request, reply, 'participant'))) return;
	const { displayName } = request.body || {};
	const result = await withTransaction(async (client) => {
		const codeResult = await client.query(USABLE_ACCESS_CODE_SQL, [normalizeAccessCode(request.params.code)]);
		if (!codeResult.rowCount) return null;
		const updated = await client.query(
			`UPDATE access_codes
			 SET status = 'claimed', claimed_by_user_id = $1,
			     display_name = $2, claimed_at = now()
			 WHERE id = $3 RETURNING *`,
			[request.user.id, displayName, codeResult.rows[0].id],
		);
		return updated.rows[0];
	});
	return result || reply.code(409).send({ error: 'Código no disponible' });
});

fastify.post('/rounds', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { tournamentId, roundNumber, problemId, capacity, timeLimitSeconds } = request.body || {};
	if (typeof tournamentId !== 'string' || !/^[0-9a-f-]{36}$/i.test(tournamentId)) {
		return reply.code(400).send({ error: 'tournamentId no es válido' });
	}
	if (typeof problemId !== 'string' || !/^[0-9a-f-]{36}$/i.test(problemId)) {
		return reply.code(400).send({ error: 'problemId no es válido' });
	}
	if (!Number.isInteger(roundNumber) || roundNumber < 1) {
		return reply.code(400).send({ error: 'roundNumber debe ser un entero desde 1' });
	}
	if (!Number.isInteger(capacity) || capacity < 1) {
		return reply.code(400).send({ error: 'capacity debe ser un entero positivo' });
	}
	if (!Number.isInteger(timeLimitSeconds) || timeLimitSeconds < 10 || timeLimitSeconds > 86400) {
		return reply.code(400).send({ error: 'timeLimitSeconds debe estar entre 10 y 86400' });
	}
	let result;
	try {
		result = await withTransaction(async (client) => {
			// El lock del torneo serializa dos altas simultáneas: sin él, las dos
			// verían el torneo vacío y quedarían dos "primeras" rondas.
			const tournament = await client.query('SELECT id FROM tournaments WHERE id = $1 FOR UPDATE', [tournamentId]);
			if (!tournament.rowCount) return { missing: true };
			const last = await client.query(
				'SELECT max(round_number) AS round_number FROM rounds WHERE tournament_id = $1',
				[tournamentId],
			);
			// Las rondas siguientes salen de POST /rounds/:id/next, que inscribe a
			// los clasificados. Una creada acá tendría el roster vacío y nadie
			// podría entrar.
			if (last.rows[0].round_number !== null) return { lastRound: last.rows[0].round_number };
			return client.query(
				`INSERT INTO rounds (tournament_id, round_number, problem_id, capacity, time_limit_seconds)
				 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
				[tournamentId, roundNumber, problemId, capacity, timeLimitSeconds],
			);
		});
	} catch (error) {
		// UNIQUE (tournament_id, round_number). Sin esto Fastify lo convierte en
		// un 500 crudo que no le dice nada al admin.
		if (error.code === '23505') {
			return reply.code(409).send({
				error: `El torneo ya tiene una ronda ${roundNumber}. Usá la ronda siguiente o elegí otro número.`,
			});
		}
		if (error.code === '23503') {
			return reply.code(404).send({ error: 'El torneo o el problema no existe' });
		}
		throw error;
	}
	if (result.missing) return reply.code(404).send({ error: 'El torneo o el problema no existe' });
	if (result.lastRound !== undefined) {
		return reply.code(409).send({
			error: `El torneo ya tiene la ronda ${result.lastRound}. La siguiente se crea con "Avanzar a la siguiente ronda", que inscribe a los clasificados.`,
		});
	}
	return reply.code(201).send(result.rows[0]);
});

fastify.get('/tournaments/:id/rounds', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query(
		`SELECT r.*, COALESCE(p.name, r.problem_name) AS problem_name,
		        (SELECT count(*)::int FROM round_participants rp
		         WHERE rp.round_id = r.id) AS participants_count,
		        (SELECT count(*)::int FROM round_participants rp
		         WHERE rp.round_id = r.id AND rp.final_status = 'advanced') AS advanced_count,
		        ${START_STATE_SQL}
		 FROM rounds r LEFT JOIN problems p ON p.id = r.problem_id
		 WHERE r.tournament_id = $1 ORDER BY r.round_number`,
		[request.params.id],
	);
	// Aditivo: start_blocked_reason es el mismo texto del 409 de /start.
	return result.rows.map((row) => {
		const reason = row.status === 'pending' ? startBlockReason(row) : null;
		const { tournament_status: _t, start_blockers: _b, has_previous: _p, has_roster: _r, ...rest } = row;
		return { ...rest, start_blocked_reason: reason };
	});
});

// Planifica todas las rondas de un torneo de una vez. Crea las que faltan y
// actualiza las pendientes; las que ya empezaron no se tocan. Una ronda
// pendiente que ya no está en el plan se borra si todavía no tiene inscriptos.
// Las rondas siguientes quedan con el roster vacío: lo llena "Avanzar" con los
// clasificados (POST /rounds/:id/next), y hasta entonces /start no las inicia.
fastify.put('/tournaments/:id/plan', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const rounds = request.body?.rounds;
	const invalid = validateRoundPlan(rounds);
	if (invalid) return reply.code(400).send({ error: invalid });
	let outcome;
	try {
		outcome = await withTransaction(async (client) => {
			const tournament = await client.query('SELECT status FROM tournaments WHERE id = $1 FOR UPDATE', [request.params.id]);
			if (!tournament.rowCount) return { status: 404, error: 'El torneo no existe' };
			if (tournament.rows[0].status === 'finished') return { status: 409, error: 'El torneo ya terminó' };
			const existing = await client.query(
				`SELECT r.id, r.round_number, r.status,
				        (SELECT count(*)::int FROM round_participants rp WHERE rp.round_id = r.id) AS enrolled
				 FROM rounds r WHERE r.tournament_id = $1 FOR UPDATE`,
				[request.params.id],
			);
			const byNumber = new Map(existing.rows.map((row) => [Number(row.round_number), row]));
			// Las jugadas siguen; el plan se completa alrededor de ellas sin huecos.
			const numbers = new Set([
				...existing.rows.filter((row) => row.status !== 'pending').map((row) => Number(row.round_number)),
				...rounds.map((round) => round.round_number),
			]);
			for (let n = 1; n <= numbers.size; n += 1) {
				if (!numbers.has(n)) return { status: 400, error: `Falta la ronda ${n}: las rondas van de 1 en adelante, sin huecos` };
			}
			for (const round of rounds) {
				const current = byNumber.get(round.round_number);
				if (current && current.status !== 'pending') continue;
				if (current && current.enrolled > 0 && round.round_number > 1 && round.capacity > current.enrolled) {
					return { status: 409, error: `Ronda ${round.round_number}: el cupo no puede ser mayor que los ${current.enrolled} inscriptos` };
				}
				if (current) {
					await client.query(
						`UPDATE rounds SET problem_id = $1, capacity = $2, time_limit_seconds = $3, difficulty = $4
						 WHERE id = $5 AND status = 'pending'`,
						[round.problemId, round.capacity, round.timeLimitSeconds, round.difficulty, current.id],
					);
				} else {
					await client.query(
						`INSERT INTO rounds (tournament_id, round_number, problem_id, capacity, time_limit_seconds, difficulty)
						 VALUES ($1, $2, $3, $4, $5, $6)`,
						[request.params.id, round.round_number, round.problemId, round.capacity, round.timeLimitSeconds, round.difficulty],
					);
				}
			}
			await client.query(
				`DELETE FROM rounds r WHERE r.tournament_id = $1 AND r.status = 'pending'
				   AND NOT (r.round_number = ANY($2::int[]))
				   AND NOT EXISTS (SELECT 1 FROM round_participants rp WHERE rp.round_id = r.id)`,
				[request.params.id, rounds.map((round) => round.round_number)],
			);
			return { status: 200 };
		});
	} catch (error) {
		if (error.code === '23503') return reply.code(404).send({ error: 'Uno de los problemas no existe' });
		throw error;
	}
	if (outcome.status !== 200) return reply.code(outcome.status).send({ error: outcome.error });
	const result = await query(
		`SELECT r.*, COALESCE(p.name, r.problem_name) AS problem_name,
		        (SELECT count(*)::int FROM round_participants rp WHERE rp.round_id = r.id) AS participants_count
		 FROM rounds r LEFT JOIN problems p ON p.id = r.problem_id
		 WHERE r.tournament_id = $1 ORDER BY r.round_number`,
		[request.params.id],
	);
	return result.rows;
});

// Lee el estado de una ronda para saber si se puede generar la siguiente y con
// quienes. Lo usa el panel para prellenar el formulario antes de crearla.
async function nextRoundPreview(roundId) {
	const roundResult = await query('SELECT * FROM rounds WHERE id = $1', [roundId]);
	if (!roundResult.rowCount) return { available: false, reason: 'La ronda no existe' };
	const round = roundResult.rows[0];

	const tournament = await query('SELECT id, status FROM tournaments WHERE id = $1', [round.tournament_id]);
	const tournamentStatus = tournament.rows[0]?.status;

	// Quien quedó con final_status 'advanced' en esta ronda es el que juega la
	// siguiente. closeRound (index.js:884) ya lo calculó.
	const advancing = await query(
		`SELECT rp.participant_id, rp.final_rank, rp.best_pass_percentage, p.display_name
		 FROM round_participants rp
		 JOIN participants p ON p.id = rp.participant_id
		 WHERE rp.round_id = $1 AND rp.final_status = 'advanced'
		 ORDER BY rp.final_rank`,
		[roundId],
	);

	// La siguiente es la que sigue a esta, no la siguiente libre. Importa: con
	// MAX(round_number)+1 el chequeo de "¿ya existe?" nunca encontraría nada,
	// porque ese número por definición no existe, y un segundo POST crearía la
	// ronda N+2 en lugar de rechazar.
	const nextRoundNumber = Number(round.round_number) + 1;

	const existing = await query(
		`SELECT r.id, r.round_number, r.status, r.problem_id, r.capacity, r.time_limit_seconds, r.difficulty,
		        (SELECT count(*)::int FROM round_participants rp WHERE rp.round_id = r.id) AS enrolled
		 FROM rounds r WHERE r.tournament_id = $1 AND r.round_number = $2`,
		[round.tournament_id, nextRoundNumber],
	);
	// Una ronda planificada (PUT /tournaments/:id/plan) existe pero sigue
	// pendiente y sin roster: avanzar la llena en vez de rechazar.
	const planned = existing.rowCount && existing.rows[0].status === 'pending' && existing.rows[0].enrolled === 0;

	const preview = {
		nextRoundNumber,
		tournamentId: round.tournament_id,
		tournamentStatus,
		roundStatus: round.status,
		advancingCount: advancing.rows.length,
		advancing: advancing.rows.map((row) => ({
			participant_id: row.participant_id,
			display_name: row.display_name,
			final_rank: row.final_rank,
			best_pass_percentage: row.best_pass_percentage,
		})),
		existing: existing.rowCount
			? {
				id: existing.rows[0].id,
				round_number: existing.rows[0].round_number,
				status: existing.rows[0].status,
				planned: Boolean(planned),
				problem_id: existing.rows[0].problem_id,
				capacity: existing.rows[0].capacity,
				time_limit_seconds: existing.rows[0].time_limit_seconds,
				difficulty: existing.rows[0].difficulty,
			}
			: null,
	};

	if (round.status !== 'closed') {
		return { ...preview, available: false, reason: 'La ronda todavía no está cerrada' };
	}
	if (tournamentStatus === 'finished') {
		return { ...preview, available: false, reason: 'El torneo ya terminó' };
	}
	if (advancing.rows.length === 0) {
		// Nadie se inscribió: no hay ganador ni a quién pasar. Sin esta salida el
		// torneo quedaba abierto para siempre.
		return {
			...preview,
			available: false,
			reason: `Nadie jugó la ronda ${round.round_number}: no hay a quién pasar. Terminá el torneo.`,
		};
	}
	if (advancing.rows.length < 2) {
		// Un solo clasificado significa que closeRound ya declaró ganador.
		return { ...preview, available: false, reason: 'No hay suficientes clasificados para otra ronda' };
	}
	if (existing.rowCount && !planned) {
		return { ...preview, available: false, reason: `La ronda ${nextRoundNumber} ya existe` };
	}
	return { ...preview, available: true };
}

fastify.get('/rounds/:id/next', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	return nextRoundPreview(request.params.id);
});

// Genera la ronda siguiente con los clasificados, ya inscriptos. Evita que el
// admin tenga que contarlos a mano y se equivoque.
fastify.post('/rounds/:id/next', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { problemId, capacity, timeLimitSeconds } = request.body || {};

	if (typeof problemId !== 'string' || !/^[0-9a-f-]{36}$/i.test(problemId)) {
		return reply.code(400).send({ error: 'problemId no es válido' });
	}
	const seconds = Number(timeLimitSeconds);
	if (!Number.isInteger(seconds) || seconds < 10 || seconds > 86400) {
		return reply.code(400).send({ error: 'timeLimitSeconds debe estar entre 10 y 86400' });
	}

	const problem = await query('SELECT id FROM problems WHERE id = $1', [problemId]);
	if (!problem.rowCount) return reply.code(404).send({ error: 'El problema no existe' });

	const preview = await nextRoundPreview(request.params.id);
	if (!preview.available) {
		return reply.code(409).send({ error: preview.reason, preview });
	}

	// Por defecto clasifican todos los que avanzaron. El admin puede bajar el
	// cupo para eliminar más, pero nunca subirlo: no hay más participantes en
	// juego que los clasificados de esta ronda.
	const requested = capacity === undefined || capacity === null ? null : Number(capacity);
	if (requested !== null && (!Number.isInteger(requested) || requested < 1)) {
		return reply.code(400).send({ error: 'capacity debe ser un entero positivo' });
	}
	if (requested !== null && requested > preview.advancingCount) {
		return reply.code(400).send({
			error: `El cupo no puede ser mayor que los ${preview.advancingCount} clasificados`,
		});
	}
	const finalCapacity = requested === null ? preview.advancingCount : requested;

	let created;
	try {
		created = await withTransaction(async (client) => {
			// La ronda planificada se completa; si no existe, se crea como antes.
			// El UPDATE exige que siga pendiente y sin roster: dos clics no la llenan dos veces.
			const inserted = preview.existing?.planned
				? await client.query(
					`UPDATE rounds r SET problem_id = $1, capacity = $2, time_limit_seconds = $3
					 WHERE r.id = $4 AND r.status = 'pending'
					   AND NOT EXISTS (SELECT 1 FROM round_participants rp WHERE rp.round_id = r.id)
					 RETURNING *`,
					[problemId, finalCapacity, seconds, preview.existing.id],
				)
				: await client.query(
					`INSERT INTO rounds (tournament_id, round_number, problem_id, capacity, time_limit_seconds)
					 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
					[preview.tournamentId, preview.nextRoundNumber, problemId, finalCapacity, seconds],
				);
			if (!inserted.rowCount) {
				const conflict = new Error('La ronda siguiente ya tiene participantes');
				conflict.code = '23505';
				throw conflict;
			}
			const nextRound = inserted.rows[0];
			// Los clasificados entran ya en la ronda. Si se dejaran para que se
			// unieran solos, un participante que no está presente bloquearía a todos.
			await client.query(
				`INSERT INTO round_participants (round_id, participant_id)
				 SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
				[nextRound.id, preview.advancing.map((entry) => entry.participant_id)],
			);
			const joined = await client.query(
				'SELECT count(*)::int AS n FROM round_participants WHERE round_id = $1',
				[nextRound.id],
			);
			return { round: nextRound, participants: joined.rows[0].n };
		});
	} catch (error) {
		// Dos POST simultáneos pasan los dos la vista previa; el UNIQUE decide.
		if (error.code === '23505') {
			return reply.code(409).send({ error: `La ronda ${preview.nextRoundNumber} ya existe` });
		}
		throw error;
	}

	fastify.io?.emit('round:created', {
		round_id: created.round.id,
		round_number: created.round.round_number,
		participants: created.participants,
	});
	return reply.code(201).send({ ...created, advancing: preview.advancing });
});

// Edita una ronda que todavía no empezó. Los tres campos son opcionales; los
// que faltan quedan como estaban. timeLimitSeconds va en segundos, igual que en
// POST /rounds: el panel convierte desde minutos.
fastify.put('/rounds/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { problemId = null, capacity = null, timeLimitSeconds = null, difficulty = null } = request.body || {};
	const error = validateRoundEdit({ problemId, capacity, timeLimitSeconds, difficulty });
	if (error) return reply.code(400).send({ error });
	let result;
	try {
		// En una ronda siguiente el roster ya está armado: un cupo mayor que los
		// inscriptos la deja sin eliminados, y nadie queda afuera por cupo. La
		// primera ronda no tiene roster hasta que la gente entra, así que ahí no
		// hay techo que comparar. Todo es condición del UPDATE, como en /start.
		result = await query(
			`UPDATE rounds r SET problem_id = COALESCE($1, r.problem_id),
			        capacity = COALESCE($2, r.capacity),
			        time_limit_seconds = COALESCE($3, r.time_limit_seconds),
			        difficulty = COALESCE($5, r.difficulty)
			 WHERE r.id = $4 AND r.status = 'pending'
			   AND ($2::int IS NULL
			     OR NOT EXISTS (SELECT 1 FROM rounds prev WHERE prev.tournament_id = r.tournament_id AND prev.round_number < r.round_number)
			     OR $2::int <= (SELECT count(*) FROM round_participants rp WHERE rp.round_id = r.id))
			 RETURNING *`,
			[problemId, capacity, timeLimitSeconds, request.params.id, difficulty],
		);
	} catch (error) {
		if (error.code === '23503') return reply.code(404).send({ error: 'El problema no existe' });
		throw error;
	}
	if (result.rowCount) return result.rows[0];
	// Solo para explicar el rechazo: la decisión ya la tomó el UPDATE.
	const why = await query(
		`SELECT r.round_number, r.status,
		        (SELECT count(*)::int FROM round_participants rp WHERE rp.round_id = r.id) AS enrolled
		 FROM rounds r WHERE r.id = $1`,
		[request.params.id],
	);
	if (!why.rowCount) return reply.code(404).send({ error: 'La ronda no existe' });
	const row = why.rows[0];
	if (row.status !== 'pending') {
		return reply.code(409).send({
			error: `La ronda ${row.round_number} ya no se puede editar: está ${ROUND_STATUS_TEXT[row.status] ?? row.status}`,
		});
	}
	return reply.code(409).send({
		error: `El cupo no puede ser mayor que los ${row.enrolled} inscriptos de la ronda ${row.round_number}`,
	});
});

fastify.delete('/rounds/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query("DELETE FROM rounds WHERE id = $1 AND status = 'pending' RETURNING id", [request.params.id]);
	return result.rowCount ? { deleted: true } : reply.code(409).send({ error: 'La ronda no existe o ya inició' });
});

fastify.post('/rounds/:id/start', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	// La cuenta regresiva vive en la base, no en un setTimeout: sobrevive a un
	// reinicio y todos los clientes cuentan hacia el mismo instante. El tiempo
	// límite corre desde starts_at, así la espera no se descuenta de la ronda.
	// La continuidad es condición del propio UPDATE, no un SELECT previo: dos
	// clics simultáneos no pueden pasar los dos. Un SELECT y un UPDATE aparte
	// dejarían una ventana entre la lectura y la escritura.
	const result = await query(
		`UPDATE rounds r SET status = 'active', started_at = now(),
			starts_at = now() + ($2::int * interval '1 second'),
			ends_at = now() + (($2::int + time_limit_seconds) * interval '1 second')
		 WHERE r.id = $1 AND r.status = 'pending' AND ${START_ALLOWED_SQL}
		 RETURNING *`,
		[request.params.id, ROUND_COUNTDOWN_SECONDS],
	);
	if (!result.rowCount) {
		// Solo para explicar el rechazo: la decisión ya la tomó el UPDATE.
		const why = await query(
			`SELECT r.round_number, r.status, ${START_STATE_SQL}
			 FROM rounds r WHERE r.id = $1`,
			[request.params.id],
		);
		if (!why.rowCount) return reply.code(404).send({ error: 'La ronda no existe' });
		const row = why.rows[0];
		if (row.status !== 'pending') {
			return reply.code(409).send({
				error: `La ronda ${row.round_number} no está pendiente: está ${ROUND_STATUS_TEXT[row.status] ?? row.status}`,
			});
		}
		const reason = startBlockReason(row);
		if (row.start_blockers) return reply.code(409).send({ error: reason, blocking: row.start_blockers });
		return reply.code(409).send({ error: reason ?? 'La ronda no puede iniciar' });
	}
	fastify.io?.emit('round:started', {
		round_id: result.rows[0].id,
		ends_at: result.rows[0].ends_at,
		capacity: result.rows[0].capacity,
		starts_at: result.rows[0].starts_at,
	});
	return result.rows[0];
});

fastify.post('/rounds/:id/pause', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query(
		`UPDATE rounds SET paused = NOT paused WHERE id = $1 AND status = 'active' RETURNING *`,
		[request.params.id],
	);
	if (!result.rowCount) return reply.code(409).send({ error: 'La ronda no está activa' });
	fastify.io?.to(`round:${request.params.id}`).emit('round:paused', result.rows[0]);
	return result.rows[0];
});

// Sala de espera: sin ronda activa, la próxima pendiente que el participante
// puede esperar. Es la primera ronda de un torneo abierto (se inscribe ahí) o
// una siguiente donde ya está en el roster. La sesión es opcional.
fastify.get('/public/rounds/upcoming', async (request) => {
	const active = await query("SELECT 1 FROM rounds WHERE status = 'active' LIMIT 1");
	if (active.rowCount) return null;
	const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
	const user = token ? await getSession(token).catch(() => null) : null;
	const result = await query(
		`SELECT r.id, r.round_number, r.capacity, t.name AS tournament_name
		 FROM rounds r JOIN tournaments t ON t.id = r.tournament_id
		 WHERE r.status = 'pending' AND t.status <> 'finished'
		   AND (
		     NOT EXISTS (SELECT 1 FROM rounds prev WHERE prev.tournament_id = r.tournament_id AND prev.round_number < r.round_number)
		     OR EXISTS (
		       SELECT 1 FROM round_participants rp JOIN participants p ON p.id = rp.participant_id
		       WHERE rp.round_id = r.id AND p.user_id = $1 AND p.status = 'active'
		     )
		   )
		 ORDER BY EXISTS (
		     SELECT 1 FROM round_participants rp JOIN participants p ON p.id = rp.participant_id
		     WHERE rp.round_id = r.id AND p.user_id = $1
		   ) DESC, t.created_at DESC, r.round_number
		 LIMIT 1`,
		[user?.id ?? null],
	);
	return result.rows[0] || null;
});

fastify.get('/public/rounds/active', async () => {
	// Endpoint sin sesión: de test_cases solo sale lo marcado como ejemplo, y
	// proyectado a stdin/expected. El resto nunca deja la base.
	const result = await query(
		`SELECT r.*, p.name AS problem_name, p.statement, p.difficulty,
		        COALESCE((
		          SELECT jsonb_agg(
		                   jsonb_build_object('stdin', tc->'stdin', 'expected', tc->'expected')
		                   ORDER BY ord)
		          FROM jsonb_array_elements(p.test_cases) WITH ORDINALITY AS t(tc, ord)
		          WHERE tc->'is_sample' = 'true'::jsonb
		        ), '[]'::jsonb) AS samples
		 FROM rounds r JOIN problems p ON p.id = r.problem_id
		 WHERE r.status = 'active' ORDER BY r.started_at DESC LIMIT 1`,
	);
	if (!result.rowCount) return null;
	const round = result.rows[0];
	const participants = await query(
		`SELECT rp.participant_id, p.display_name AS name, p.character, rp.best_pass_percentage,
		        rp.solved_at, rp.failed_attempts_count
		 FROM round_participants rp JOIN participants p ON p.id = rp.participant_id
		 WHERE rp.round_id = $1 ORDER BY p.display_name`,
		[round.id],
	);
	return { ...round, participants: participants.rows };
});

fastify.post('/rounds/:id/close', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await closeRound(request.params.id);
	return result;
});

fastify.get('/rounds/:id/state', async (request) => {
	const result = await query(
		`SELECT r.*, COALESCE(p.name, r.problem_name) AS problem_name
		 FROM rounds r LEFT JOIN problems p ON p.id = r.problem_id WHERE r.id = $1`,
		[request.params.id],
	);
	return result.rows[0] || null;
});

fastify.post('/rounds/:id/submissions', async (request, reply) => {
	if (!(await requireRole(request, reply, 'participant'))) return;
	const { participantId, code, language } = request.body || {};
	if (
		typeof participantId !== 'string' ||
		typeof code !== 'string' ||
		code.length === 0 ||
		code.length > 100_000 ||
		!['python', 'c', 'cpp'].includes(language)
	) {
		return reply.code(400).send({ error: 'Envío inválido: use Python, C o C++ y hasta 100000 caracteres' });
	}
	const recent = submissionRate.get(request.user.id) || 0;
	if (Date.now() - recent < 1000) return reply.code(429).send({ error: 'Espera antes de enviar otra solución' });
	submissionRate.set(request.user.id, Date.now());
	const round = await query(
		"SELECT *, starts_at > now() AS counting_down FROM rounds WHERE id = $1 AND status = 'active' AND ends_at > now()",
		[request.params.id],
	);
	if (!round.rowCount) return reply.code(409).send({ error: 'La ronda no está activa' });
	if (round.rows[0].paused) return reply.code(409).send({ error: 'La ronda está pausada' });
	// El editor deshabilitado es solo la mitad: sin este corte, un envío por API
	// saldría antes que los demás. starts_at NULL (rondas viejas) da NULL y pasa.
	if (round.rows[0].counting_down) return reply.code(409).send({ error: 'La ronda todavía no empezó' });
	const participant = await query(
		`SELECT p.id, p.display_name FROM participants p
		 JOIN round_participants rp ON rp.participant_id = p.id AND rp.round_id = $1
		 WHERE p.id = $2 AND p.user_id = $3 AND p.tournament_id = $4 AND p.status = 'active'`,
		[request.params.id, participantId, request.user.id, round.rows[0].tournament_id],
	);
	if (!participant.rowCount) return reply.code(403).send({ error: 'Participante no válido para esta ronda' });

	const submission = await query(
		`INSERT INTO submissions (round_id, participant_id, code, language)
		 VALUES ($1, $2, $3, $4) RETURNING *`,
		[request.params.id, participantId, code, language],
	);
	const queued = submission.rows[0];
	try {
		await submissionQueue.add(
			'execute',
			{
				submissionId: queued.id,
				code,
				language,
				roundId: request.params.id,
				participantId,
			},
			{ jobId: queued.id },
		);
	} catch (error) {
		await query("UPDATE submissions SET verdict = 'queue_error' WHERE id = $1", [queued.id]);
		throw error;
	}
	const publicSubmission = {
		id: queued.id,
		round_id: queued.round_id,
		participant_id: queued.participant_id,
		display_name: participant.rows[0].display_name,
		language: queued.language,
		submitted_at: queued.submitted_at,
		verdict: queued.verdict,
	};
	fastify.io?.emit('submission:queued', publicSubmission);
	return reply.code(202).send(publicSubmission);
});

// "Probar código": corre el programa contra los casos de ejemplo o contra una
// entrada propia y devuelve la salida. No guarda nada: ni submissions, ni
// penalización, ni eventos de socket. Comparte el presupuesto de Judge0 con los
// envíos reales, pero a lo sumo RUN_MAX_IN_FLIGHT casos de prueba a la vez, así
// nunca dejan sin lugar a la cola de envíos.
const RUN_MAX_IN_FLIGHT = Number(process.env.JUDGE0_RUN_MAX_IN_FLIGHT || 2);
const runSlots = createLimiter(RUN_MAX_IN_FLIGHT);
const RUN_INTERVAL_MS = Number(process.env.RUN_INTERVAL_MS || 3000);
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS || 20000);
const RUN_MAX_STDIN = 64 * 1024;
const RUN_MAX_SAMPLES = 10;
const RUN_MAX_OUTPUT = 4000;

// Validación de POST /rounds/:id/run que no necesita la base. null = válido.
function validateRunPayload(body) {
	const { participantId, code, language, stdin } = body || {};
	if (typeof participantId !== 'string' || typeof code !== 'string' || code.length === 0 || code.length > 100_000) {
		return 'Código inválido: hasta 100000 caracteres';
	}
	if (!['python', 'c', 'cpp'].includes(language)) return 'Lenguaje no soportado: use Python, C o C++';
	if (stdin !== undefined && stdin !== null && (typeof stdin !== 'string' || stdin.length > RUN_MAX_STDIN)) {
		return 'La entrada personalizada debe ser texto de hasta 64 KB';
	}
	return null
}

const clip = (text) => {
	if (typeof text !== 'string') return '';
	return text.length > RUN_MAX_OUTPUT ? `${text.slice(0, RUN_MAX_OUTPUT)}\n… (salida recortada)` : text
};

// Resultado de un caso para el participante. passed solo existe si hay salida
// esperada: con entrada personalizada no hay contra qué comparar.
function summarizeRun(result, testCase) {
	const accepted = result.status?.id === 3;
	const stdout = result.stdout ?? '';
	const summary = {
		status: result.status?.description || 'Error',
		stdin: testCase.stdin ?? '',
		stdout: clip(stdout),
		stderr: clip(result.stderr ?? ''),
		compile_output: clip(result.compile_output ?? ''),
		time: result.time ?? null,
		memory: result.memory ?? null,
	};
	if (typeof testCase.expected === 'string') {
		summary.expected = testCase.expected;
		summary.passed = accepted && stdout.trim() === testCase.expected.trim();
		if (accepted && !summary.passed) summary.status = 'Wrong Answer';
	}
	return summary
}

fastify.post('/rounds/:id/run', async (request, reply) => {
	if (!(await requireRole(request, reply, 'participant'))) return;
	const invalid = validateRunPayload(request.body);
	if (invalid) return reply.code(400).send({ error: invalid });
	const { participantId, code, language } = request.body;
	const custom = typeof request.body.stdin === 'string';
	const recent = runRate.get(request.user.id) || 0;
	if (Date.now() - recent < RUN_INTERVAL_MS) {
		return reply.code(429).send({ error: 'Espera unos segundos antes de volver a probar' });
	}
	runRate.set(request.user.id, Date.now());
	// Mismas condiciones que un envío: si no se puede enviar, tampoco probar.
	const round = await query(
		`SELECT r.tournament_id, r.paused, r.starts_at > now() AS counting_down, p.test_cases
		 FROM rounds r JOIN problems p ON p.id = r.problem_id
		 WHERE r.id = $1 AND r.status = 'active' AND r.ends_at > now()`,
		[request.params.id],
	);
	if (!round.rowCount) return reply.code(409).send({ error: 'La ronda no está activa' });
	if (round.rows[0].paused) return reply.code(409).send({ error: 'La ronda está pausada' });
	if (round.rows[0].counting_down) return reply.code(409).send({ error: 'La ronda todavía no empezó' });
	const participant = await query(
		`SELECT p.id FROM participants p
		 JOIN round_participants rp ON rp.participant_id = p.id AND rp.round_id = $1
		 WHERE p.id = $2 AND p.user_id = $3 AND p.tournament_id = $4 AND p.status = 'active'`,
		[request.params.id, participantId, request.user.id, round.rows[0].tournament_id],
	);
	if (!participant.rowCount) return reply.code(403).send({ error: 'Participante no válido para esta ronda' });

	// Solo los casos marcados como ejemplo, que el participante ya ve en pantalla.
	const allCases = Array.isArray(round.rows[0].test_cases) ? round.rows[0].test_cases : [];
	const cases = custom
		? [{ stdin: request.body.stdin }]
		: allCases
			.filter((testCase) => testCase?.is_sample === true)
			.slice(0, RUN_MAX_SAMPLES)
			.map((testCase) => ({ stdin: String(testCase.stdin ?? ''), expected: String(testCase.expected ?? '') }));
	if (!cases.length) {
		return reply.code(409).send({ error: 'Este problema no tiene casos de ejemplo: prueba con una entrada personalizada' });
	}
	let results;
	try {
		results = await runTestCases(cases, (testCase) => judge0Slots.run(async () => {
			const created = await createSubmission(code, language, testCase.stdin);
			const result = await waitForSubmission(created.token, { timeoutMs: RUN_TIMEOUT_MS });
			return summarizeRun(result, testCase);
		}), runSlots);
	} catch (error) {
		request.log.error(error, 'Falló la prueba de código');
		return reply.code(502).send({ error: 'El juez no respondió. Intenta de nuevo en unos segundos' });
	}
	const graded = results.filter((result) => typeof result.passed === 'boolean');
	return {
		mode: custom ? 'custom' : 'samples',
		results,
		passed: graded.filter((result) => result.passed).length,
		total: graded.length,
	};
});

fastify.get('/rounds/:id/leaderboard', async (request) => {
	// El tiempo corre desde el fin de la cuenta regresiva. Las rondas sin
	// starts_at (anteriores a la columna) siguen contando desde started_at.
	const result = await query(
		`SELECT rp.*, p.display_name, p.character,
		        EXTRACT(EPOCH FROM rp.solved_at - COALESCE(r.starts_at, r.started_at)
		          + rp.penalty_seconds * interval '1 second')::int AS total_time_seconds
		 FROM round_participants rp
		 JOIN participants p ON p.id = rp.participant_id
		 JOIN rounds r ON r.id = rp.round_id
		 WHERE rp.round_id = $1
		 ORDER BY rp.final_rank NULLS LAST, (rp.solved_at IS NULL), rp.solved_at ASC NULLS LAST,
		 rp.best_pass_percentage DESC, rp.penalty_seconds ASC`,
		[request.params.id],
	);
	return result.rows;
});

fastify.get('/rounds/:id/submissions', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query(
		`SELECT s.id, s.participant_id, p.display_name, s.language, s.verdict,
		        s.test_cases_passed, s.test_cases_total, s.case_results, s.submitted_at
		 FROM submissions s JOIN participants p ON p.id = s.participant_id
		 WHERE s.round_id = $1 ORDER BY s.submitted_at DESC LIMIT 200`,
		[request.params.id],
	);
	return result.rows;
});

// Historial del participante autenticado. El participante sale de la sesión
// (p.user_id), nunca del body ni de la query: así nadie puede pedir los envíos
// de otro. Sin case_results: traen los tokens de Judge0.
fastify.get('/rounds/:id/submissions/mine', async (request, reply) => {
	if (!(await requireRole(request, reply, 'participant'))) return;
	if (!/^[0-9a-f-]{36}$/i.test(request.params.id)) return reply.code(400).send({ error: 'Ronda inválida' });
	const result = await query(
		`SELECT s.id, s.participant_id, s.language, s.verdict,
		        s.test_cases_passed, s.test_cases_total, s.submitted_at
		 FROM submissions s JOIN participants p ON p.id = s.participant_id
		 WHERE s.round_id = $1 AND p.user_id = $2
		 ORDER BY s.submitted_at DESC LIMIT 200`,
		[request.params.id, request.user.id],
	);
	return result.rows;
});

// Veredictos que dicen que falló la infraestructura, no el programa: el encolado
// (queue_error), el job de BullMQ (judge_error) y los dos status de Judge0 que
// son del sandbox (13 Internal Error, 14 Exec Format Error). WA, TLE, CE y RE
// son evaluaciones que funcionaron y no cuentan como fallidos.
const INFRA_FAILURE_VERDICTS = ['queue_error', 'judge_error', 'Internal Error', 'Exec Format Error'];

// round: los envíos de la ronda activa, contados en submissions. Es la única
// fuente que sabe de qué ronda es cada envío y no cambia si Redis se vacía.
// 'queued' cubre a la vez "en espera" y "ejecutándose": la base no los separa,
// así que sale un solo número, pending. null = no hay ronda activa.
// waiting..delayed son los contadores globales de BullMQ en Redis, de todas las
// rondas y con hasta 1000 completados retenidos (removeOnComplete). Se conservan
// por compatibilidad; null si Redis no responde (queue_available: false).
fastify.get('/queue/stats', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	// La ronda activa con el criterio de /public/rounds/active.
	const active = await query(
		`SELECT r.id, r.round_number, r.status, t.id AS tournament_id, t.name AS tournament_name,
		        count(s.id)::int AS total,
		        count(s.id) FILTER (WHERE s.verdict = 'queued')::int AS pending,
		        count(s.id) FILTER (WHERE s.verdict <> 'queued')::int AS completed,
		        count(s.id) FILTER (WHERE s.verdict = ANY($1::text[]))::int AS failed
		 FROM rounds r
		 JOIN tournaments t ON t.id = r.tournament_id
		 LEFT JOIN submissions s ON s.round_id = r.id
		 WHERE r.id = (SELECT id FROM rounds WHERE status = 'active' ORDER BY started_at DESC LIMIT 1)
		 GROUP BY r.id, t.id`,
		[INFRA_FAILURE_VERDICTS],
	);
	let counts = null;
	try {
		counts = await submissionQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
	} catch (error) {
		request.log.error(error, 'Queue stats failed');
	}
	return {
		round: active.rows[0] ?? null,
		queue_available: counts !== null,
		waiting: counts ? counts.waiting ?? 0 : null,
		active: counts ? counts.active ?? 0 : null,
		completed: counts ? counts.completed ?? 0 : null,
		failed: counts ? counts.failed ?? 0 : null,
		delayed: counts ? counts.delayed ?? 0 : null,
	};
});

fastify.get('/tournaments/:id/leaderboard', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query(
		`SELECT p.id AS participant_id, p.display_name,
			MAX(rp.final_rank) FILTER (WHERE rp.final_rank IS NOT NULL) AS final_rank,
			MAX(rp.best_pass_percentage) AS best_pass_percentage,
			SUM(rp.failed_attempts_count)::int AS failed_attempts_count,
			SUM(rp.penalty_seconds)::int AS penalty_seconds,
			SUM(EXTRACT(EPOCH FROM rp.solved_at - COALESCE(r.starts_at, r.started_at)
			  + rp.penalty_seconds * interval '1 second'))::int AS total_time_seconds
		 FROM participants p JOIN round_participants rp ON rp.participant_id = p.id
		 JOIN rounds r ON r.id = rp.round_id
		 WHERE r.tournament_id = $1
		 GROUP BY p.id, p.display_name
		 ORDER BY final_rank NULLS LAST, best_pass_percentage DESC, failed_attempts_count ASC`,
		[request.params.id],
	);
	return result.rows;
});

async function canAccessSocketRound(user, roundId) {
	if (typeof roundId !== 'string' || !/^[0-9a-f-]{36}$/i.test(roundId)) return false;
	const round = await query('SELECT id FROM rounds WHERE id = $1', [roundId]);
	if (!round.rowCount) return false;
	if (user.role === 'admin') return true;
	// Roster y status = 'active', los dos: es la frontera que impide que un
	// eliminado lea la ronda por el socket.
	return Boolean(await roundMember(roundId, user.id))
}

// Veredicto final de un envío, para la cola del admin y el historial del
// participante. Aditivo: submission:queued y participant:progress no cambian.
// Solo a la sala de la ronda, que canAccessSocketRound ya restringe al admin y
// a los inscriptos activos; no sale a los sockets sin sesión.
function emitSubmissionJudged(row, displayName) {
	fastify.io?.to(`round:${row.round_id}`).emit('submission:judged', {
		id: row.id,
		round_id: row.round_id,
		participant_id: row.participant_id,
		display_name: displayName,
		language: row.language,
		verdict: row.verdict,
		test_cases_passed: row.test_cases_passed,
		test_cases_total: row.test_cases_total,
		submitted_at: row.submitted_at,
	})
}

async function start() {
	await initDb();
	await fastify.listen({ port: Number(process.env.PORT || 3000), host: '127.0.0.1' });
	fastify.io = new Server(fastify.server, { cors: { origin: allowedOrigins } });
	fastify.io.use(async (socket, next) => {
		const authToken = typeof socket.handshake.auth?.token === 'string'
			? socket.handshake.auth.token
			: socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
		if (!authToken) {
			socket.data.user = null;
			return next();
		}
		try {
			const user = await getSession(authToken);
			if (!user) return next(new Error('Sesión inválida'));
			socket.data.user = user;
			return next();
		} catch (error) {
			return next(new Error('Sesión no disponible'));
		}
	});
	const loadTestCases = async ({ submissionId }) => {
		const problem = await query(
			`SELECT p.test_cases FROM submissions s
			 JOIN rounds r ON r.id = s.round_id
			 JOIN problems p ON p.id = r.problem_id
			 WHERE s.id = $1 AND s.verdict = 'queued'`,
			[submissionId],
		);
		if (!problem.rowCount) return null;
		return Array.isArray(problem.rows[0].test_cases) ? problem.rows[0].test_cases : [];
	};
	const submissionWorker = startSubmissionWorker(loadTestCases, async ({ submissionId, testCases, results }) => {
		const submissionRow = await query(
			`SELECT s.round_id, s.participant_id, s.verdict, pa.display_name,
			        r.status AS round_status, r.ends_at, r.paused
			 FROM submissions s
			 JOIN rounds r ON r.id = s.round_id
			 JOIN participants pa ON pa.id = s.participant_id
			 WHERE s.id = $1`,
			[submissionId],
		);
		if (!submissionRow.rowCount || submissionRow.rows[0].verdict !== 'queued') return null;
		const submission = submissionRow.rows[0];
		if (submission.round_status !== 'active' || submission.paused || new Date(submission.ends_at) <= new Date()) {
			// Sin este evento la fila quedaba en "queued" para siempre: este camino
			// no emite participant:progress.
			const unavailable = await query(
				"UPDATE submissions SET verdict = 'round_unavailable' WHERE id = $1 AND verdict = 'queued' RETURNING *",
				[submissionId],
			);
			if (unavailable.rowCount) emitSubmissionJudged(unavailable.rows[0], submission.display_name);
			return unavailable.rows[0] || null;
		}
		const caseResults = results.map(({ result, token }, index) => {
			const expected = (testCases[index]?.expected ?? '').toString().trim();
			const actual = result.stdout?.toString().trim() ?? '';
			const passed = result.status?.id === 3 && actual === expected;
			const status = passed
				? 'accepted'
				: (result.status?.id === 3 ? 'Wrong Answer' : (result.status?.description || 'rejected'));
			return { passed, status, token };
		});
		const total = caseResults.length;
		const passed = caseResults.filter((caseResult) => caseResult.passed).length;
		// Judge0 da el tiempo de cada caso en segundos (texto). Se guarda el mayor.
		const times = results.map(({ result }) => Number.parseFloat(result.time)).filter(Number.isFinite);
		const execMs = times.length ? Math.round(Math.max(...times) * 1000) : null;
		const solved = total > 0 && passed === total;
		// Accepted solo con todos los casos. Si no, el veredicto es el del primer caso fallido.
		const verdict = solved
			? 'accepted'
			: (caseResults.find((caseResult) => !caseResult.passed)?.status || 'no_test_cases');
		const updated = await query(
			`UPDATE submissions SET verdict = $1, judge0_token = $2,
				test_cases_passed = $3, test_cases_total = $4, case_results = $5::jsonb, exec_ms = $7
			 WHERE id = $6 AND verdict = 'queued' RETURNING *`,
			[verdict, results.at(-1)?.token ?? null, passed, total, JSON.stringify(caseResults), submissionId, execMs],
		);
		if (!updated.rowCount) return null;

		const { round_id: roundId, participant_id: participantId } = submission;
		// Un fallo solo cuenta mientras el participante no haya resuelto. En el SET,
		// solved_at es el valor previo a este UPDATE, así que el contador y la
		// penalización suben juntos en una sola sentencia.
		await query(
			`UPDATE round_participants
			 SET best_pass_percentage = GREATEST(best_pass_percentage, $1),
			     solved_at = CASE WHEN $2 THEN COALESCE(solved_at, now()) ELSE solved_at END,
			     failed_attempts_count = failed_attempts_count
			       + CASE WHEN NOT $2 AND solved_at IS NULL THEN 1 ELSE 0 END,
			     penalty_seconds = penalty_seconds
			       + CASE WHEN NOT $2 AND solved_at IS NULL THEN 30 ELSE 0 END
			 WHERE round_id = $3 AND participant_id = $4`,
			[total ? Math.round((passed * 10000) / total) / 100 : 0, solved, roundId, participantId],
		);
		const capacityResult = await query('SELECT capacity FROM rounds WHERE id = $1', [roundId]);
		const solvedResult = await query(
			`SELECT count(*)::int AS solved FROM round_participants
			 WHERE round_id = $1 AND solved_at IS NOT NULL`,
			[roundId],
		);
		if (capacityResult.rowCount && solvedResult.rows[0].solved >= capacityResult.rows[0].capacity) {
			await closeRound(roundId);
		}
		const progress = {
			participant_id: submission.participant_id,
			test_cases_passed: passed,
			test_cases_total: total,
			// Sin tokens: participant:progress sale a todos los sockets, con o sin sesión.
			case_results: caseResults.map((caseResult) => ({ passed: caseResult.passed, status: caseResult.status })),
			solved,
		};
		fastify.io?.to(`round:${submission.round_id}`).emit('participant:progress', progress);
		fastify.io?.emit('participant:progress', progress);
		emitSubmissionJudged(updated.rows[0], submission.display_name);
		return updated.rows[0];
	});
	submissionWorker.on('error', (error) => {
		fastify.log.error(error, 'Submission worker error');
	});
	submissionWorker.on('failed', (job, error) => {
		void (async () => {
			fastify.log.error({ error, submissionId: job?.data?.submissionId }, 'Submission failed');
			if (!job?.data?.submissionId) return;
			const failed = await query(
				`UPDATE submissions s SET verdict = 'judge_error'
				 FROM participants pa
				 WHERE s.id = $1 AND s.verdict = 'queued' AND pa.id = s.participant_id
				 RETURNING s.*, pa.display_name`,
				[job.data.submissionId],
			);
			if (failed.rowCount) {
				// Se conserva para los clientes que solo escuchan submission:queued.
				fastify.io?.emit('submission:queued', {
					id: failed.rows[0].id,
					round_id: failed.rows[0].round_id,
					participant_id: failed.rows[0].participant_id,
					verdict: 'judge_error',
				});
				emitSubmissionJudged(failed.rows[0], failed.rows[0].display_name);
			}
		})().catch((updateError) => fastify.log.error(updateError, 'Could not mark failed submission'));
	});
	fastify.io.on('connection', (socket) => {
		socket.on('round:join', async (roundId) => {
			if (!socket.data.user) {
				socket.emit('socket:error', { error: 'Sesión requerida' });
				return;
			}
			try {
				if (!(await canAccessSocketRound(socket.data.user, roundId))) {
					socket.emit('socket:error', { error: 'Ronda no disponible' });
					return;
				}
				await socket.join(`round:${roundId}`);
			} catch (error) {
				socket.emit('socket:error', { error: 'No se pudo validar la ronda' });
			}
		});
		socket.on('round:snapshot', async (roundId) => {
			if (!socket.data.user) {
				socket.emit('socket:error', { error: 'Sesión requerida' });
				return;
			}
			try {
				if (!(await canAccessSocketRound(socket.data.user, roundId))) {
					socket.emit('round:snapshot', null);
					return;
				}
				const result = await query(
					`SELECT r.*, COALESCE(p.name, r.problem_name) AS problem_name, p.statement, p.difficulty
					 FROM rounds r LEFT JOIN problems p ON p.id = r.problem_id
					 WHERE r.id = $1`,
					[roundId],
				);
				socket.emit('round:snapshot', result.rows[0] || null);
			} catch (error) {
				socket.emit('socket:error', { error: 'No se pudo cargar la ronda' });
			}
		});
	});
	// Cada ronda vencida se cierra por separado y su error se registra: sin el
	// try, una ronda que falla al cerrar (o la base caída) rechazaba la promesa
	// del intervalo, Node terminaba el proceso y las demás no se cerraban nunca.
	setInterval(async () => {
		let expired;
		try {
			expired = await query(`SELECT id FROM rounds WHERE status = 'active' AND ends_at <= now()`);
		} catch (error) {
			fastify.log.error({ err: error }, 'No se pudieron buscar las rondas vencidas');
			return;
		}
		for (const round of expired.rows) {
			try {
				await closeRound(round.id);
			} catch (error) {
				fastify.log.error({ err: error, roundId: round.id }, 'No se pudo cerrar la ronda vencida');
			}
		}
	}, 1000).unref();
}

async function closeRound(roundId) {
	return withTransaction(async (client) => {
		const roundResult = await client.query(
			`SELECT * FROM rounds WHERE id = $1 FOR UPDATE`,
			[roundId],
		);
		if (!roundResult.rowCount) throw new Error('Ronda no encontrada');
		const round = roundResult.rows[0];
		if (round.status === 'closed') return round;

		await client.query("UPDATE rounds SET status = 'closing' WHERE id = $1", [roundId]);
		const ranking = await client.query(
			`SELECT participant_id, best_pass_percentage, solved_at, failed_attempts_count, penalty_seconds
			 FROM round_participants WHERE round_id = $1
			 ORDER BY (solved_at IS NULL), solved_at ASC NULLS LAST,
			 best_pass_percentage DESC, penalty_seconds ASC, failed_attempts_count ASC, participant_id`,
			[roundId],
		);
		const ranked = ranking.rows.map((row, index) => ({ ...row, rank: index + 1 }));
		for (const row of ranked) {
			const finalStatus = row.rank <= round.capacity ? 'advanced' : 'eliminated';
			await client.query(
				`UPDATE round_participants SET final_rank = $1, final_status = $2
				 WHERE round_id = $3 AND participant_id = $4`,
				[row.rank, finalStatus, roundId, row.participant_id],
			);
			await client.query(
				`UPDATE participants SET status = CASE WHEN $1 = 'eliminated' THEN 'eliminated' ELSE status END
				 WHERE id = $2`,
				[finalStatus, row.participant_id],
			);
		}
		const closed = await client.query(
			"UPDATE rounds SET status = 'closed' WHERE id = $1 RETURNING *",
			[roundId],
		);
		const advanced = ranked.filter((row) => row.rank <= round.capacity);
		if (advanced.length === 1) {
			await client.query("UPDATE participants SET status = 'winner' WHERE id = $1", [advanced[0].participant_id]);
			await client.query("UPDATE tournaments SET status = 'finished' WHERE id = $1", [round.tournament_id]);
			// Any code still unused for this tournament dies with it, in the same
			// transaction that declares the winner.
			await expireTournamentAccessCodes(client, round.tournament_id);
			fastify.io?.emit('tournament:winner', { participant_id: advanced[0].participant_id });
			fastify.io?.emit('ceremony:update', { tournament_id: round.tournament_id });
		}
		fastify.io?.emit('round:closed', {
			// Aditivo: sin el id, un cliente no sabe qué ronda se cerró.
			round_id: roundId,
			ranking: ranked.map((row) => ({
				participant_id: row.participant_id,
				final_rank: row.rank,
				final_status: row.rank <= round.capacity ? 'advanced' : 'eliminated',
			})),
		});
		return { round: closed.rows[0], ranking: ranked };
	});
}

if (require.main === module) {
	start().catch((error) => {
		fastify.log.error(error);
		process.exit(1);
	});
}

module.exports = {
	fastify, start, requireRole, sessions: memorySessions, closeRound, describeStartBlock, startBlockReason,
	validateRoundEdit, ORPHAN_USER_SQL, parseIdList, TOURNAMENT_DELETABLE_SQL, PROBLEM_DELETABLE_SQL,
	INFRA_FAILURE_VERDICTS, MAX_BODY_BYTES, validateRunPayload, summarizeRun, validateRoundPlan,
	CHARACTER_COUNT,
	// Expuestos para test/auth-rate-limit.test.js: el rate limit vive en el
	// servidor y sin esto habria que.matchear contra una DB real para probarlo.
	AUTH_IDENTITY_LIMIT: authIdentityLimit, AUTH_IP_LIMIT: authIpLimit,
	recordAuthFailureForTest: recordAuthFailure, clearAuthFailuresForTest: clearAuthFailuresForRequest,
	authFailureCountForTest: (key) => getAuthFailure(key)?.count ?? 0,
	authLimitForTest: authLimitForKey,
};
