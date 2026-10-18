// Reglas puras del módulo caster. Contrato en test/caster-contract.test.js.

// Las cuentas de caster leen el código de todos: llevan un código más largo que
// el PIN de 6 de los participantes.
const CASTER_CODE_LENGTH = 12;
const CASTER_NAME_MAX = 40;

// Veredictos que no suman intento fallido ni penalización (index.js, worker):
// el envío no llegó a evaluarse o falló la infraestructura.
const NO_PENALTY_VERDICTS = new Set(['accepted', 'queued', 'round_unavailable', 'queue_error', 'judge_error']);

/** Nombre de una cuenta de caster: 3 a 40 caracteres, sin espacios al borde. */
function validateCasterName(raw) {
	const name = typeof raw === 'string' ? raw.trim() : '';
	if (name.length < 3 || name.length > CASTER_NAME_MAX) {
		return { error: `El nombre del caster debe tener entre 3 y ${CASTER_NAME_MAX} caracteres` };
	}
	return { name }
}

/**
 * Código elegido por el admin para una cuenta de caster (opcional: si no lo da,
 * se genera uno). Se guarda normalizado, como los PIN: el login acepta
 * minúsculas, espacios y guiones. De 8 a 64 letras o dígitos.
 */
function validateCasterCode(raw) {
	if (raw === undefined || raw === null || raw === '') return { code: null };
	const code = typeof raw === 'string' ? raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
	if (code.length < 8 || code.length > 64) {
		return { error: 'El código del caster debe tener entre 8 y 64 letras o dígitos' };
	}
	return { code }
}

/**
 * El código de un envío Aceptado no se muestra hasta que cierra la ronda: el
 * caster lo podría pasar a la transmisión y sería la solución para los demás.
 */
function isCodeLocked(verdict, roundStatus) {
	return verdict === 'accepted' && roundStatus !== 'closed'
}

/** case_results sin los tokens de Judge0: solo si pasó y su estado. */
function publicCases(caseResults) {
	if (!Array.isArray(caseResults)) return [];
	return caseResults.map((result) => ({
		passed: Boolean(result?.passed),
		status: typeof result?.status === 'string' ? result.status : 'rejected',
	}))
}

/**
 * Penalización que sumó un envío: la de los hits activos al enviarlo
 * (penaltyFor de hits.js), solo si falló y el participante no había resuelto.
 */
function submissionPenalty({ verdict, submittedAt, solvedAt }, hitRows, penaltyFor) {
	if (NO_PENALTY_VERDICTS.has(verdict)) return 0;
	if (solvedAt !== null && solvedAt !== undefined && solvedAt <= submittedAt) return 0;
	return penaltyFor(hitRows, submittedAt)
}

/**
 * Lista de envíos de una ronda para el caster, sin código. `rows` viene ordenado
 * del más nuevo al más viejo; el número de intento se cuenta por participante.
 */
function casterSubmissions(rows, hitRows, penaltyFor) {
	const toMs = (value) => (value ? new Date(value).getTime() : null);
	const attempts = new Map();
	const attemptOf = new Map();
	for (const row of [...rows].reverse()) {
		const count = (attempts.get(row.participant_id) ?? 0) + 1;
		attempts.set(row.participant_id, count);
		attemptOf.set(row.id, count);
	}
	return rows.map((row) => ({
		id: row.id,
		participant_id: row.participant_id,
		display_name: row.display_name,
		character: row.character ?? 0,
		language: row.language,
		verdict: row.verdict,
		test_cases_passed: row.test_cases_passed,
		test_cases_total: row.test_cases_total,
		submitted_at: row.submitted_at,
		attempt: attemptOf.get(row.id),
		penalty_seconds: submissionPenalty(
			{ verdict: row.verdict, submittedAt: toMs(row.submitted_at), solvedAt: toMs(row.solved_at) },
			hitRows,
			penaltyFor,
		),
	}))
}

/** Un envío con su código (o sin él, si está bloqueado) y el resultado por caso. */
function casterSubmissionDetail(row) {
	const locked = isCodeLocked(row.verdict, row.round_status);
	return {
		id: row.id,
		round_id: row.round_id,
		round_number: row.round_number,
		round_status: row.round_status,
		participant_id: row.participant_id,
		display_name: row.display_name,
		character: row.character ?? 0,
		language: row.language,
		verdict: row.verdict,
		test_cases_passed: row.test_cases_passed,
		test_cases_total: row.test_cases_total,
		submitted_at: row.submitted_at,
		attempt: Number(row.attempt) || 1,
		case_results: publicCases(row.case_results),
		locked,
		code: locked ? null : row.code,
	}
}

module.exports = {
	CASTER_CODE_LENGTH, validateCasterName, validateCasterCode, isCodeLocked, publicCases, submissionPenalty,
	casterSubmissions, casterSubmissionDetail,
};
