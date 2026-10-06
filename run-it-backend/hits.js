// Voto del público: la grada elige por QR un hit bueno o uno malo que cae sobre
// la ronda en vivo. Reglas: un hit nunca toca el editor, el enunciado ni el
// veredicto; cae sobre todos por igual; cada votación enfrenta un bueno contra
// un malo del mismo peso. Funciones puras: index.js pone la base y los sockets.

// duration en ms: 0 = se aplica de una vez (tiempo, cupo); null = dura hasta
// que cierra la ronda (la pista del organizador).
const HITS = {
	extra: { kind: 'bueno', duration: 0 },
	amnistia: { kind: 'bueno', duration: 90_000 },
	'cupo-mas': { kind: 'bueno', duration: 0 },
	pista: { kind: 'bueno', duration: null },
	aliento: { kind: 'bueno', duration: 10_000 },
	'penal-doble': { kind: 'malo', duration: 120_000 },
	'reloj-oculto': { kind: 'malo', duration: 60_000 },
	apagon: { kind: 'malo', duration: 45_000 },
	niebla: { kind: 'malo', duration: 75_000 },
	'cupo-menos': { kind: 'malo', duration: 0 },
};

const PAIRS = [
	{ weight: 2, good: 'extra', bad: 'niebla' },
	{ weight: 2, good: 'amnistia', bad: 'penal-doble' },
	{ weight: 3, good: 'cupo-mas', bad: 'cupo-menos' },
	{ weight: 1, good: 'pista', bad: 'reloj-oculto' },
	{ weight: 1, good: 'aliento', bad: 'apagon' },
];

/** Votaciones por ronda: 2 como máximo (se recomienda 1). */
const MAX_POLLS = 2;
/** "Votación próxima" antes de abrir, para que la grada saque el celular. */
const ANNOUNCE_MS = 15_000;
const POLL_MS = 40_000;
/** Sin votaciones en el primer minuto ni en los últimos 2 de la ronda. */
const QUIET_START_MS = 60_000;
const QUIET_END_MS = 120_000;
const EXTRA_MS = 60_000;
const PENALTY_SECONDS = 30;

/**
 * Por qué no se puede anunciar el par `pairIndex` ahora, o null si se puede.
 * `state`: { now, round: { status, paused, startsAt, endsAt, capacity },
 * enrolled, solved, polls: [{ good, bad, status }], hasHint }.
 */
function pollBlockReason(pairIndex, state) {
	const pair = PAIRS[pairIndex];
	if (!pair) return 'El par no existe';
	const { now, round, polls } = state;
	if (round.status !== 'active') return 'La ronda no está en curso';
	if (round.paused) return 'La ronda está pausada';
	if (round.startsAt && now < round.startsAt) return 'La ronda todavía no empezó';
	const live = polls.filter((poll) => poll.status !== 'cancelled');
	if (live.some((poll) => poll.status === 'open')) return 'Ya hay una votación en curso';
	if (live.length >= MAX_POLLS) return `Ya hubo ${MAX_POLLS} votaciones en esta ronda`;
	if (round.startsAt && now - round.startsAt < QUIET_START_MS) return 'Sin votaciones en el primer minuto';
	if (round.endsAt - now < QUIET_END_MS + ANNOUNCE_MS + POLL_MS) return 'Sin votaciones en los últimos 2 minutos';
	if (live.some((poll) => poll.good === pair.good)) return 'Ese par ya se usó en esta ronda';
	if (pair.weight === 3) {
		if (round.capacity <= 2) return 'Con cupo 2 o menos no se tocan los cupos';
		if (round.capacity + 1 >= state.enrolled) return 'Con este cupo pasarían todos';
		if (state.solved >= round.capacity - 1) return 'Ya casi se llenó el cupo';
	}
	if (pair.good === 'pista' && !state.hasHint) return 'El problema no tiene pista cargada';
	return null
}

/** Ganador de una votación cerrada. Empate: se sortea; nunca decide el organizador. */
function pickWinner(pair, tally, random = Math.random) {
	if (tally.good === tally.bad) return random() < 0.5 ? pair.good : pair.bad;
	return tally.good > tally.bad ? pair.good : pair.bad
}

/** Hits activos en `at` (ms) sobre la lista de round_hits. */
function activeAt(hits, at) {
	return hits.filter((hit) => !hit.cancelledAt && hit.startsAt <= at && (hit.endsAt === null || hit.endsAt > at));
}

/** Penalización de un envío fallido según los hits activos cuando se envió. */
function penaltyFor(hits, submittedAt) {
	const active = activeAt(hits, submittedAt).map((hit) => hit.hit);
	if (active.includes('amnistia')) return 0;
	if (active.includes('penal-doble')) return PENALTY_SECONDS * 2;
	return PENALTY_SECONDS
}

module.exports = {
	HITS, PAIRS, MAX_POLLS, ANNOUNCE_MS, POLL_MS, QUIET_START_MS, QUIET_END_MS, EXTRA_MS, PENALTY_SECONDS,
	pollBlockReason, pickWinner, activeAt, penaltyFor,
};
