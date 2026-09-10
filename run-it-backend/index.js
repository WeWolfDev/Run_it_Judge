const fastify = require('fastify')({ logger: true });

const crypto = require('node:crypto');
const cors = require('@fastify/cors');
const { Server } = require('socket.io');
const { initDb, query, withTransaction } = require('./db');
const { submissionQueue, startSubmissionWorker } = require('./queue');
const { setSession, getSession, deleteSession, memorySessions } = require('./session-store');

const submissionRate = new Map();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:8080,http://127.0.0.1:8080')
	.split(',')
	.map((origin) => origin.trim())
	.filter(Boolean);

fastify.register(cors, { origin: allowedOrigins });

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.get('/ready', async (request, reply) => {
	try {
		await query('SELECT 1');
		await submissionQueue.getJobCounts();
		return { status: 'ready', database: 'ok', redis: 'ok' };
	} catch (error) {
		request.log.error(error, 'Readiness check failed');
		return reply.code(503).send({ status: 'not_ready' });
	}
});

fastify.post('/auth/login', async (request, reply) => {
	const { username, accessCode } = request.body || {};
	const result = await query(
		'SELECT id, username, role FROM users WHERE username = $1 AND access_code = $2',
		[username, accessCode],
	);

	if (result.rowCount === 0) {
		return reply.code(401).send({ error: 'Credenciales inválidas' });
	}

	const user = result.rows[0];
	const token = crypto.randomUUID();
	await setSession(token, user);
	return { token, user };
});

fastify.post('/auth/register', async (request, reply) => {
	const username = String(request.body?.username || '').trim();
	const accessCode = String(request.body?.accessCode || '').trim();

	if (username.length < 3 || accessCode.length < 8) {
		return reply.code(400).send({ error: 'Usuario y código de acceso no válidos' });
	}

	try {
		const user = await withTransaction(async (client) => {
			const codeResult = await client.query(
				"SELECT id FROM access_codes WHERE code = $1 AND status = 'unused' FOR UPDATE",
				[accessCode],
			);
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

		const token = crypto.randomUUID();
		await setSession(token, user);
		return { token, user };
	} catch (error) {
		if (error.code === '23505') {
			return reply.code(409).send({ error: 'El nombre de usuario ya está en uso' });
		}
		if (error.code === 'ACCESS_CODE_UNAVAILABLE') {
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
		return reply.code(401).send({ error: 'Sesión requerida' });
	}

	if (role && user.role !== role) {
		return reply.code(403).send({ error: 'Rol insuficiente' });
	}

	request.user = user;
}

fastify.post('/tournaments', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const { name } = request.body || {};
	const result = await query('INSERT INTO tournaments (name) VALUES ($1) RETURNING *', [name]);
	return reply.code(201).send(result.rows[0]);
});

fastify.get('/tournaments', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query('SELECT * FROM tournaments ORDER BY created_at DESC');
	return result.rows;
});

fastify.put('/tournaments/:id', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const name = String(request.body?.name || '').trim();
	if (!name) return reply.code(400).send({ error: 'El nombre es obligatorio' });
	const result = await query('UPDATE tournaments SET name = $1 WHERE id = $2 RETURNING *', [name, request.params.id]);
	return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'Torneo no encontrado' });
});

fastify.delete('/tournaments/:id', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query('DELETE FROM tournaments WHERE id = $1 RETURNING id', [request.params.id]);
	return result.rowCount ? { deleted: true } : reply.code(404).send({ error: 'Torneo no encontrado' });
});

fastify.get('/problems', async () => {
	const result = await query('SELECT * FROM problems ORDER BY created_at DESC');
	return result.rows;
});

fastify.post('/problems', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const { name, statement, difficulty = 'easy', testCases = [] } = request.body || {};
	if (!name || !statement || !Array.isArray(testCases)) {
		return reply.code(400).send({ error: 'name, statement y testCases son obligatorios' });
	}
	const result = await query(
		`INSERT INTO problems (name, statement, difficulty, test_cases)
		 VALUES ($1, $2, $3, $4::jsonb) RETURNING *`,
		[name, statement, difficulty, JSON.stringify(testCases)],
	);
	return reply.code(201).send(result.rows[0]);
});

fastify.get('/problems/:id', async (request, reply) => {
	const result = await query('SELECT * FROM problems WHERE id = $1', [request.params.id]);
	return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'Problema no encontrado' });
});

fastify.put('/problems/:id', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const { name, statement, difficulty = 'easy', testCases = [] } = request.body || {};
	if (!name || !statement || !Array.isArray(testCases)) {
		return reply.code(400).send({ error: 'name, statement y testCases son obligatorios' });
	}
	const result = await query(
		`UPDATE problems SET name = $1, statement = $2, difficulty = $3, test_cases = $4::jsonb
		 WHERE id = $5 RETURNING *`,
		[name, statement, difficulty, JSON.stringify(testCases), request.params.id],
	);
	return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'Problema no encontrado' });
});

fastify.delete('/problems/:id', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	try {
		const result = await query('DELETE FROM problems WHERE id = $1 RETURNING id', [request.params.id]);
		return result.rowCount ? { deleted: true } : reply.code(404).send({ error: 'Problema no encontrado' });
	} catch (error) {
		if (error.code === '23503') return reply.code(409).send({ error: 'El problema está siendo usado por una ronda' });
		throw error;
	}
});

fastify.post('/tournaments/:id/participants', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const { userId, displayName } = request.body || {};
	const result = await query(
		`INSERT INTO participants (tournament_id, user_id, display_name)
		 VALUES ($1, $2, $3) RETURNING *`,
		[request.params.id, userId, displayName],
	);
	return reply.code(201).send(result.rows[0]);
});

fastify.post('/rounds/:id/participants/join', async (request, reply) => {
	if (await requireRole(request, reply, 'participant')) return;
	const round = await query("SELECT * FROM rounds WHERE id = $1 AND status IN ('pending', 'active')", [request.params.id]);
	if (!round.rowCount) return reply.code(409).send({ error: 'La ronda no está disponible' });
	const displayName = request.body?.displayName || request.user.username;
	const participant = await query(
		`INSERT INTO participants (tournament_id, user_id, display_name)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (tournament_id, user_id) DO UPDATE SET display_name = EXCLUDED.display_name
		 RETURNING *`,
		[round.rows[0].tournament_id, request.user.id, displayName],
	);
	await query(
		`INSERT INTO round_participants (round_id, participant_id)
		 VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		[request.params.id, participant.rows[0].id],
	);
	return participant.rows[0];
});

fastify.post('/tournaments/:id/start', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query(
		"UPDATE tournaments SET status = 'active' WHERE id = $1 RETURNING *",
		[request.params.id],
	);
	return result.rowCount ? result.rows[0] : reply.code(404).send({ error: 'Torneo no encontrado' });
});

fastify.post('/access-codes/generate', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const count = Math.min(Math.max(Number(request.body?.count || 1), 1), 500);
	const codes = [];
	for (let index = 0; index < count; index += 1) {
		const code = `RUNIT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
		const result = await query('INSERT INTO access_codes (code) VALUES ($1) RETURNING code', [code]);
		codes.push(result.rows[0].code);
	}
	return reply.code(201).send({ codes });
});

fastify.post('/access-codes/:code/claim', async (request, reply) => {
	if (await requireRole(request, reply, 'participant')) return;
	const { displayName } = request.body || {};
	const result = await query(
		`UPDATE access_codes SET status = 'claimed', claimed_by_user_id = $1,
			display_name = $2, claimed_at = now()
		 WHERE code = $3 AND status = 'unused' RETURNING *`,
		[request.user.id, displayName, request.params.code],
	);
	return result.rowCount ? result.rows[0] : reply.code(409).send({ error: 'Código no disponible' });
});

fastify.post('/rounds', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const { tournamentId, roundNumber, problemId, capacity, timeLimitSeconds } = request.body || {};
	const result = await query(
		`INSERT INTO rounds (tournament_id, round_number, problem_id, capacity, time_limit_seconds)
		 VALUES ($1, $2, $3, $4, $5) RETURNING *`,
		[tournamentId, roundNumber, problemId, capacity, timeLimitSeconds],
	);
	return reply.code(201).send(result.rows[0]);
});

fastify.get('/tournaments/:id/rounds', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query(
		`SELECT r.*, p.name AS problem_name
		 FROM rounds r JOIN problems p ON p.id = r.problem_id
		 WHERE r.tournament_id = $1 ORDER BY r.round_number`,
		[request.params.id],
	);
	return result.rows;
});

fastify.put('/rounds/:id', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
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
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query("DELETE FROM rounds WHERE id = $1 AND status = 'pending' RETURNING id", [request.params.id]);
	return result.rowCount ? { deleted: true } : reply.code(409).send({ error: 'La ronda no existe o ya inició' });
});

fastify.post('/rounds/:id/start', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query(
		`UPDATE rounds SET status = 'active', started_at = now(),
			ends_at = now() + (time_limit_seconds * interval '1 second')
		 WHERE id = $1 AND status = 'pending' RETURNING *`,
		[request.params.id],
	);
	if (!result.rowCount) return reply.code(409).send({ error: 'La ronda no puede iniciar' });
	fastify.io?.emit('round:started', {
		round_id: result.rows[0].id,
		ends_at: result.rows[0].ends_at,
		capacity: result.rows[0].capacity,
	});
	return result.rows[0];
});

fastify.post('/rounds/:id/pause', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query(
		`UPDATE rounds SET paused = NOT paused WHERE id = $1 AND status = 'active' RETURNING *`,
		[request.params.id],
	);
	if (!result.rowCount) return reply.code(409).send({ error: 'La ronda no está activa' });
	fastify.io?.to(`round:${request.params.id}`).emit('round:paused', result.rows[0]);
	return result.rows[0];
});

fastify.get('/public/rounds/active', async () => {
	const result = await query(
		`SELECT r.*, p.name AS problem_name, p.statement, p.difficulty, p.test_cases
		 FROM rounds r JOIN problems p ON p.id = r.problem_id
		 WHERE r.status = 'active' ORDER BY r.started_at DESC LIMIT 1`,
	);
	if (!result.rowCount) return null;
	const round = result.rows[0];
	const participants = await query(
		`SELECT rp.participant_id, p.display_name AS name, rp.best_pass_percentage,
		        rp.solved_at, rp.failed_attempts_count
		 FROM round_participants rp JOIN participants p ON p.id = rp.participant_id
		 WHERE rp.round_id = $1 ORDER BY p.display_name`,
		[round.id],
	);
	return { ...round, participants: participants.rows };
});

fastify.post('/rounds/:id/close', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
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
	if (await requireRole(request, reply, 'participant')) return;
	const { participantId, code, language } = request.body || {};
	const recent = submissionRate.get(request.user.id) || 0;
	if (Date.now() - recent < 1000) return reply.code(429).send({ error: 'Espera antes de enviar otra solución' });
	submissionRate.set(request.user.id, Date.now());
	const round = await query("SELECT * FROM rounds WHERE id = $1 AND status = 'active'", [request.params.id]);
	if (!round.rowCount) return reply.code(409).send({ error: 'La ronda no está activa' });
	const participant = await query(
		`SELECT id FROM participants WHERE id = $1 AND user_id = $2 AND tournament_id = $3`,
		[participantId, request.user.id, round.rows[0].tournament_id],
	);
	if (!participant.rowCount) return reply.code(403).send({ error: 'Participante no válido' });
	if (round.rows[0].paused) return reply.code(409).send({ error: 'La ronda está pausada' });

	const submission = await query(
		`INSERT INTO submissions (round_id, participant_id, code, language)
		 VALUES ($1, $2, $3, $4) RETURNING *`,
		[request.params.id, participantId, code, language],
	);
	await submissionQueue.add('execute', {
		submissionId: submission.rows[0].id,
		code,
		language,
		roundId: request.params.id,
		participantId,
	});
	fastify.io?.emit('submission:queued', submission.rows[0]);
	return reply.code(202).send(submission.rows[0]);
});

fastify.get('/rounds/:id/leaderboard', async (request) => {
	const result = await query(
		`SELECT rp.*, p.display_name FROM round_participants rp
		 JOIN participants p ON p.id = rp.participant_id
		 WHERE rp.round_id = $1 ORDER BY rp.final_rank NULLS LAST, rp.best_pass_percentage DESC`,
		[request.params.id],
	);
	return result.rows;
});

fastify.get('/rounds/:id/submissions', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query(
		`SELECT s.id, s.participant_id, p.display_name, s.language, s.verdict,
		        s.test_cases_passed, s.test_cases_total, s.submitted_at
		 FROM submissions s JOIN participants p ON p.id = s.participant_id
		 WHERE s.round_id = $1 ORDER BY s.submitted_at DESC LIMIT 200`,
		[request.params.id],
	);
	return result.rows;
});

fastify.get('/tournaments/:id/leaderboard', async (request, reply) => {
	if (await requireRole(request, reply, 'admin')) return;
	const result = await query(
		`SELECT p.id AS participant_id, p.display_name,
			MAX(rp.final_rank) FILTER (WHERE rp.final_rank IS NOT NULL) AS final_rank,
			MAX(rp.best_pass_percentage) AS best_pass_percentage,
			SUM(rp.failed_attempts_count)::int AS failed_attempts_count
		 FROM participants p JOIN round_participants rp ON rp.participant_id = p.id
		 JOIN rounds r ON r.id = rp.round_id
		 WHERE r.tournament_id = $1
		 GROUP BY p.id, p.display_name
		 ORDER BY final_rank NULLS LAST, best_pass_percentage DESC, failed_attempts_count ASC`,
		[request.params.id],
	);
	return result.rows;
});

async function start() {
	await initDb();
	await fastify.listen({ port: Number(process.env.PORT || 3000), host: '127.0.0.1' });
	fastify.io = new Server(fastify.server, { cors: { origin: allowedOrigins } });
	startSubmissionWorker(async ({ submissionId, result, token }) => {
		const submissionRow = await query(
			`SELECT s.round_id, s.participant_id, p.test_cases
			 FROM submissions s
			 JOIN rounds r ON r.id = s.round_id
			 JOIN problems p ON p.id = r.problem_id
			 WHERE s.id = $1`,
			[submissionId],
		);
		const testCases = submissionRow.rows[0]?.test_cases || [];
		const expected = (testCases[0]?.expected ?? '').toString().trim();
		const actual = result.stdout?.toString().trim() ?? '';
		const passed = result.status?.id === 3 && expected !== '' && actual === expected ? 1 : 0;
		const verdict = passed === 1
			? 'accepted'
			: (result.status?.description || 'rejected');
		const updated = await query(
			`UPDATE submissions SET verdict = $1, judge0_token = $2,
				test_cases_passed = $3, test_cases_total = 1 WHERE id = $4 RETURNING *`,
			[verdict, token, passed, submissionId],
		);
		if (submissionRow.rowCount) {
			const { round_id: roundId, participant_id: participantId } = submissionRow.rows[0];
			await query(
				`UPDATE round_participants
				 SET best_pass_percentage = GREATEST(best_pass_percentage, $1),
				     solved_at = CASE WHEN $2 THEN COALESCE(solved_at, now()) ELSE solved_at END,
				     failed_attempts_count = failed_attempts_count + CASE WHEN $2 THEN 0 ELSE 1 END
				 WHERE round_id = $3 AND participant_id = $4`,
				[passed * 100, passed === 1, roundId, participantId],
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
		}
		fastify.io?.emit('participant:progress', {
			participant_id: submissionRow.rows[0]?.participant_id,
			test_cases_passed: passed,
			test_cases_total: 1,
			solved: passed === 1,
		});
		return updated.rows[0];
	});
	fastify.io.on('connection', (socket) => {
		socket.on('round:join', (roundId) => socket.join(`round:${roundId}`));
		socket.on('round:snapshot', async (roundId) => {
			const result = await query('SELECT * FROM rounds WHERE id = $1', [roundId]);
			socket.emit('round:snapshot', result.rows[0] || null);
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
			`SELECT participant_id, best_pass_percentage, solved_at, failed_attempts_count
			 FROM round_participants WHERE round_id = $1
			 ORDER BY (solved_at IS NULL), solved_at ASC NULLS LAST,
			 best_pass_percentage DESC, failed_attempts_count ASC, participant_id`,
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
			fastify.io?.emit('tournament:winner', { participant_id: advanced[0].participant_id });
		}
		fastify.io?.emit('round:closed', {
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

module.exports = { fastify, start, requireRole, sessions: memorySessions, closeRound };
