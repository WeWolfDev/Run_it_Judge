const fastify = require('fastify')({ logger: true, trustProxy: ['127.0.0.1', '::1'] });

const crypto = require('node:crypto');
const cors = require('@fastify/cors');
const { Server } = require('socket.io');
const { initDb, query, withTransaction } = require('./db');
const { submissionQueue, startSubmissionWorker } = require('./queue');
const {
  setSession,
  getSession,
  deleteSession,
  getSessionStoreStatus,
  memorySessions,
} = require('./session-store');

const submissionRate = new Map();
const authFailures = new Map();
const authFailureWindowMs = Number(process.env.AUTH_FAILURE_WINDOW_MS || 15 * 60 * 1000);
const authFailureLimit = Number(process.env.AUTH_FAILURE_LIMIT || 5);

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

function authRetryAfter(request, identity) {
	const keys = [`ip:${request.ip}`];
	const normalizedIdentity = normalizeAuthIdentity(identity);
	if (normalizedIdentity) keys.push(`identity:${normalizedIdentity}`);

	let retryAfterMs = 0;
	for (const key of keys) {
		const failure = getAuthFailure(key);
		if (!failure) continue;
		const remainingMs = authFailureWindowMs - (Date.now() - failure.firstFailureAt);
		if (failure.count >= authFailureLimit) retryAfterMs = Math.max(retryAfterMs, remainingMs);
	}
	return Math.ceil(retryAfterMs / 1000);
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
// Igual que CHARACTER_COUNT de frontend/src/lib/session.ts y silk-{0..9} de styles.css.
const CHARACTER_COUNT = 10;
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
		return `La ronda ${row.round_number} no tiene participantes: solo la juegan los clasificados de la anterior. Borrala y creala con "Avanzar a la siguiente ronda".`;
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
fastify.register(cors, { origin: allowedOrigins, exposedHeaders: ['Date'] });

// Un valor que Postgres no puede convertir (22P02: "abc" como uuid en /rounds/abc)
// es un error del cliente, no un 500. Todo lo demás sigue al manejador por
// defecto de Fastify, igual que antes.
fastify.setErrorHandler((error, request, reply) => {
	if (error.code === '22P02') {
		request.log.info({ err: error }, 'Valor inválido para Postgres');
		return reply.code(400).send({ error: 'Identificador no válido' });
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

	clearIdentityAuthFailures(username);
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

		clearIdentityAuthFailures(username);
		const token = crypto.randomUUID();
		await setSession(token, user);
		return { token, user };
	} catch (error) {
		if (error.code === '23505') {
			return reply.code(409).send({ error: 'El nombre de usuario ya está en uso' });
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

fastify.get('/tournaments', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query('SELECT * FROM tournaments ORDER BY created_at DESC');
	return result.rows;
});

fastify.put('/tournaments/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const name = String(request.body?.name || '').trim();
	if (!name) return reply.code(400).send({ error: 'El nombre es obligatorio' });
	const result = await query('UPDATE tournaments SET name = $1 WHERE id = $2 RETURNING *', [name, request.params.id]);
	return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'Torneo no encontrado' });
});

fastify.delete('/tournaments/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const result = await query('DELETE FROM tournaments WHERE id = $1 RETURNING id', [request.params.id]);
	return result.rowCount ? { deleted: true } : reply.code(404).send({ error: 'Torneo no encontrado' });
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
		`SELECT r.id, r.round_number, r.status, t.name AS tournament_name
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

fastify.delete('/problems/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	try {
		const result = await query('DELETE FROM problems WHERE id = $1 RETURNING id', [request.params.id]);
		return result.rowCount ? { deleted: true } : reply.code(404).send({ error: 'Problema no encontrado' });
	} catch (error) {
		if (error.code === '23503') return reply.code(409).send({ error: 'El problema está siendo usado por una ronda' });
		throw error;
	}
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
	return result;
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
		`SELECT r.*, p.name AS problem_name,
		        (SELECT count(*)::int FROM round_participants rp
		         WHERE rp.round_id = r.id) AS participants_count,
		        (SELECT count(*)::int FROM round_participants rp
		         WHERE rp.round_id = r.id AND rp.final_status = 'advanced') AS advanced_count,
		        ${START_STATE_SQL}
		 FROM rounds r JOIN problems p ON p.id = r.problem_id
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
		'SELECT id, round_number, status FROM rounds WHERE tournament_id = $1 AND round_number = $2',
		[round.tournament_id, nextRoundNumber],
	);

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
			? { id: existing.rows[0].id, round_number: existing.rows[0].round_number, status: existing.rows[0].status }
			: null,
	};

	if (round.status !== 'closed') {
		return { ...preview, available: false, reason: 'La ronda todavía no está cerrada' };
	}
	if (tournamentStatus === 'finished') {
		return { ...preview, available: false, reason: 'El torneo ya terminó' };
	}
	if (advancing.rows.length < 2) {
		// Un solo clasificado significa que closeRound ya declaró ganador.
		return { ...preview, available: false, reason: 'No hay suficientes clasificados para otra ronda' };
	}
	if (existing.rowCount) {
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
			const inserted = await client.query(
				`INSERT INTO rounds (tournament_id, round_number, problem_id, capacity, time_limit_seconds)
				 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
				[preview.tournamentId, preview.nextRoundNumber, problemId, finalCapacity, seconds],
			);
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

fastify.put('/rounds/:id', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	const { problemId, capacity, timeLimitSeconds } = request.body || {};
	const result = await query(
		`UPDATE rounds SET problem_id = COALESCE($1, problem_id), capacity = COALESCE($2, capacity),
		 time_limit_seconds = COALESCE($3, time_limit_seconds)
		 WHERE id = $4 AND status = 'pending' RETURNING *`,
		[problemId, capacity, timeLimitSeconds, request.params.id],
	);
	return result.rowCount ? result.rows[0] : reply.code(409).send({ error: 'La ronda no existe o ya inició' });
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
		`SELECT r.*, p.name AS problem_name
		 FROM rounds r JOIN problems p ON p.id = r.problem_id WHERE r.id = $1`,
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

fastify.get('/rounds/:id/leaderboard', async (request) => {
	// El tiempo corre desde el fin de la cuenta regresiva. Las rondas sin
	// starts_at (anteriores a la columna) siguen contando desde started_at.
	const result = await query(
		`SELECT rp.*, p.display_name,
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

fastify.get('/queue/stats', async (request, reply) => {
	if (!(await requireRole(request, reply, 'admin'))) return;
	try {
		const counts = await submissionQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
		return {
			waiting: counts.waiting ?? 0,
			active: counts.active ?? 0,
			completed: counts.completed ?? 0,
			failed: counts.failed ?? 0,
			delayed: counts.delayed ?? 0,
		};
	} catch (error) {
		request.log.error(error, 'Queue stats failed');
		return reply.code(503).send({ error: 'La cola no está disponible' });
	}
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
		const solved = total > 0 && passed === total;
		// Accepted solo con todos los casos. Si no, el veredicto es el del primer caso fallido.
		const verdict = solved
			? 'accepted'
			: (caseResults.find((caseResult) => !caseResult.passed)?.status || 'no_test_cases');
		const updated = await query(
			`UPDATE submissions SET verdict = $1, judge0_token = $2,
				test_cases_passed = $3, test_cases_total = $4, case_results = $5::jsonb
			 WHERE id = $6 AND verdict = 'queued' RETURNING *`,
			[verdict, results.at(-1)?.token ?? null, passed, total, JSON.stringify(caseResults), submissionId],
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
					`SELECT r.*, p.name AS problem_name, p.statement, p.difficulty
					 FROM rounds r JOIN problems p ON p.id = r.problem_id
					 WHERE r.id = $1`,
					[roundId],
				);
				socket.emit('round:snapshot', result.rows[0] || null);
			} catch (error) {
				socket.emit('socket:error', { error: 'No se pudo cargar la ronda' });
			}
		});
	});
	setInterval(async () => {
		const expired = await query(
			`SELECT id FROM rounds WHERE status = 'active' AND ends_at <= now()`,
		);
		for (const round of expired.rows) await closeRound(round.id);
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

module.exports = { fastify, start, requireRole, sessions: memorySessions, closeRound, describeStartBlock, startBlockReason };
