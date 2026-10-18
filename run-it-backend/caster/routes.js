const crypto = require('node:crypto');
const caster = require('./domain');

const ACCESS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const UUID_RE = /^[0-9a-f-]{36}$/i;

function generateCasterCode() {
	let code = '';
	for (let position = 0; position < caster.CASTER_CODE_LENGTH; position += 1) {
		code += ACCESS_CODE_ALPHABET[crypto.randomInt(ACCESS_CODE_ALPHABET.length)];
	}
	return code;
}

module.exports = function registerCasterRoutes({
	fastify,
	query,
	requireRole,
	deleteSession,
	fogActive,
	roundHitRows,
	penaltyFor,
}) {
	async function requireCaster(request, reply) {
		if (!(await requireRole(request, reply))) return false;
		const { role, id } = request.user;
		if (role === 'admin') return true;
		if (role !== 'caster') {
			reply.code(403).send({ error: 'Rol insuficiente' });
			return false;
		}
		const alive = await query("SELECT 1 FROM users WHERE id = $1 AND role = 'caster'", [id]);
		if (!alive.rowCount) {
			const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
			if (token) await deleteSession(token);
			reply.code(401).send({ error: 'Sesión requerida' });
			return false;
		}
		return true;
	}

	fastify.get('/casters', async (request, reply) => {
		if (!(await requireRole(request, reply, 'admin'))) return;
		const result = await query(
			"SELECT id, username, access_code, created_at FROM users WHERE role = 'caster' ORDER BY created_at",
		);
		return result.rows;
	});

	fastify.post('/casters', async (request, reply) => {
		if (!(await requireRole(request, reply, 'admin'))) return;
		const { name, error } = caster.validateCasterName(request.body?.username);
		if (error) return reply.code(400).send({ error });
		const chosen = caster.validateCasterCode(request.body?.accessCode);
		if (chosen.error) return reply.code(400).send({ error: chosen.error });
		const reserved = await query(
			"SELECT 1 FROM users WHERE role = 'admin' AND lower(username) = lower($1)",
			[name],
		);
		if (reserved.rowCount) return reply.code(409).send({ error: 'Ese nombre está reservado. Elegí otro.' });
		for (let attempt = 0; attempt < 5; attempt += 1) {
			try {
				const created = await query(
					`INSERT INTO users (username, access_code, role) VALUES ($1, $2, 'caster')
					 RETURNING id, username, access_code, created_at`,
					[name, chosen.code ?? generateCasterCode()],
				);
				return reply.code(201).send(created.rows[0]);
			} catch (insertError) {
				if (insertError.code !== '23505') throw insertError;
				if (chosen.code) return reply.code(409).send({ error: 'Ese código ya está en uso. Elegí otro.' });
			}
		}
		return reply.code(500).send({ error: 'No se pudo generar un código único' });
	});

	fastify.delete('/casters/:id', async (request, reply) => {
		if (!(await requireRole(request, reply, 'admin'))) return;
		if (!UUID_RE.test(request.params.id)) return reply.code(400).send({ error: 'Caster inválido' });
		const removed = await query(
			"DELETE FROM users WHERE id = $1 AND role = 'caster' RETURNING id",
			[request.params.id],
		);
		if (!removed.rowCount) return reply.code(404).send({ error: 'Caster no encontrado' });
		return { deleted: removed.rows[0].id };
	});

	fastify.get('/caster/overview', async (request, reply) => {
		if (!(await requireCaster(request, reply))) return;
		const active = await query(
			`SELECT r.id, r.tournament_id, r.round_number, r.status, r.paused, r.capacity,
			        r.starts_at, r.started_at, r.ends_at,
			        COALESCE(p.name, r.problem_name) AS problem_name, p.statement,
			        COALESCE((
			          SELECT jsonb_agg(
			                   jsonb_build_object('stdin', tc->'stdin', 'expected', tc->'expected')
			                   ORDER BY ord)
			          FROM jsonb_array_elements(p.test_cases) WITH ORDINALITY AS t(tc, ord)
			          WHERE tc->'is_sample' = 'true'::jsonb
			        ), '[]'::jsonb) AS samples
			 FROM rounds r LEFT JOIN problems p ON p.id = r.problem_id
			 WHERE r.status = 'active' ORDER BY r.started_at DESC LIMIT 1`,
		);
		const previous = await query(
			`SELECT r.id, r.round_number, COALESCE(p.name, r.problem_name) AS problem_name
			 FROM rounds r LEFT JOIN problems p ON p.id = r.problem_id
			 WHERE r.status = 'closed' ORDER BY r.started_at DESC NULLS LAST LIMIT 1`,
		);
		return { active: active.rows[0] || null, previous: previous.rows[0] || null };
	});

	fastify.get('/caster/rounds/:id/submissions', async (request, reply) => {
		if (!(await requireCaster(request, reply))) return;
		const roundId = request.params.id;
		if (!UUID_RE.test(roundId)) return reply.code(400).send({ error: 'Ronda inválida' });
		const round = await query(
			'SELECT id, round_number, status, starts_at, started_at FROM rounds WHERE id = $1',
			[roundId],
		);
		if (!round.rowCount) return reply.code(404).send({ error: 'Ronda no encontrada' });
		if (request.user.role !== 'admin' && (await fogActive(roundId))) {
			return { round: round.rows[0], fog: true, submissions: [] };
		}
		const rows = await query(
			`SELECT s.id, s.participant_id, p.display_name, p.character, s.language, s.verdict,
			        s.test_cases_passed, s.test_cases_total, s.submitted_at, rp.solved_at
			 FROM submissions s
			 JOIN participants p ON p.id = s.participant_id
			 LEFT JOIN round_participants rp ON rp.round_id = s.round_id AND rp.participant_id = s.participant_id
			 WHERE s.round_id = $1 ORDER BY s.submitted_at DESC LIMIT 300`,
			[roundId],
		);
		const submissions = caster.casterSubmissions(
			rows.rows,
			await roundHitRows(roundId),
			penaltyFor,
		);
		return { round: round.rows[0], fog: false, submissions };
	});

	fastify.get('/caster/submissions/:id', async (request, reply) => {
		if (!(await requireCaster(request, reply))) return;
		if (!UUID_RE.test(request.params.id)) return reply.code(400).send({ error: 'Envío inválido' });
		const result = await query(
			`SELECT s.id, s.round_id, s.participant_id, s.code, s.language, s.verdict,
			        s.test_cases_passed, s.test_cases_total, s.case_results, s.submitted_at,
			        p.display_name, p.character, r.status AS round_status, r.round_number,
			        (SELECT count(*)::int FROM submissions s2
			         WHERE s2.round_id = s.round_id AND s2.participant_id = s.participant_id
			           AND s2.submitted_at <= s.submitted_at) AS attempt
			 FROM submissions s
			 JOIN participants p ON p.id = s.participant_id
			 JOIN rounds r ON r.id = s.round_id
			 WHERE s.id = $1`,
			[request.params.id],
		);
		if (!result.rowCount) return reply.code(404).send({ error: 'Envío no encontrado' });
		return caster.casterSubmissionDetail(result.rows[0]);
	});
};
