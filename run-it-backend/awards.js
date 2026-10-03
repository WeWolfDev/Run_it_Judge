// Premios honoríficos del final del torneo. Función pura sobre los resultados
// guardados (round_participants) y los envíos (submissions). Si nadie cumple la
// condición de un premio, queda desierto y no se devuelve.

const clock = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const secondsBetween = (from, to) => Math.max(0, Math.round((new Date(to) - new Date(from)) / 1000));
const iso = (value) => new Date(value).toISOString();
const who = (row) => ({
	participant_id: row.participant_id,
	display_name: row.display_name,
	character: row.character,
});

// Peor puesto de cada participante en la segunda mitad de la ronda, rearmando
// el ranking con los envíos en orden (mismo criterio que el servidor). Al
// principio todos están últimos porque nadie envió nada: eso no es remontar.
function worstRankLate(round, submissions) {
	const half = iso((new Date(round.started_at).getTime() + new Date(round.ended_at).getTime()) / 2);
	const state = new Map(round.rows.map((row) => [row.participant_id, { pct: 0, solved: null, fails: 0 }]));
	const worst = new Map();
	const ordered = submissions
		.filter((sub) => sub.round_number === round.round_number)
		.sort((a, b) => iso(a.submitted_at).localeCompare(iso(b.submitted_at)));
	for (const sub of ordered) {
		const current = state.get(sub.participant_id);
		if (!current) continue;
		if (sub.verdict === 'accepted') {
			current.solved = current.solved ?? iso(sub.submitted_at);
			current.pct = 100;
		} else {
			current.fails += 1;
			current.pct = Math.max(current.pct, Math.round((sub.passed / Math.max(1, sub.total)) * 100));
		}
		if (iso(sub.submitted_at) < half) continue;
		const ranking = [...state.entries()].sort(([, a], [, b]) => {
			if (Boolean(a.solved) !== Boolean(b.solved)) return a.solved ? -1 : 1;
			if (a.solved && b.solved) return a.solved.localeCompare(b.solved);
			if (a.pct !== b.pct) return b.pct - a.pct;
			return a.fails - b.fails;
		});
		ranking.forEach(([id], index) => worst.set(id, Math.max(worst.get(id) ?? 0, index + 1)));
	}
	return worst;
}

/**
 * rounds: [{ round_number, capacity, started_at, ended_at, rows: [{ participant_id,
 *   display_name, character, final_rank, final_status, solved_at,
 *   failed_attempts_count }] }]
 * submissions: [{ participant_id, round_number, submitted_at, verdict, passed,
 *   total, exec_ms }]
 */
function computeAwards(rounds, submissions) {
	const awards = [];
	const sorted = [...rounds].sort((a, b) => a.round_number - b.round_number);
	const first = sorted[0];
	const final = sorted[sorted.length - 1];
	if (!first || !final) return awards;
	const rowOf = (roundNumber, participantId) => sorted
		.find((round) => round.round_number === roundNumber)
		?.rows.find((row) => row.participant_id === participantId);

	// El Ave Fénix: clasificó después de haber estado más lejos del corte.
	let phoenix = null;
	for (const round of sorted) {
		const worst = worstRankLate(round, submissions);
		for (const row of round.rows) {
			if (row.final_status !== 'advanced') continue;
			const gap = (worst.get(row.participant_id) ?? 0) - round.capacity;
			if (gap > 0 && (!phoenix || gap > phoenix.gap)) {
				phoenix = { row, gap, round, worst: worst.get(row.participant_id) };
			}
		}
	}
	if (phoenix) {
		awards.push({
			id: 'fenix',
			title: 'El Ave Fénix',
			description: 'La remontada del torneo: clasificó estando al borde de la eliminación.',
			winner: who(phoenix.row),
			detail: `En la ronda ${phoenix.round.round_number} llegó a ir ${phoenix.worst}.º (cupo ${phoenix.round.capacity}) y clasificó.`,
		});
	}

	// El Matagigantes: la peor preclasificación (ranking de la ronda 1) que quedó
	// por encima de uno de los 3 favoritos en la ronda que lo eliminó.
	const seed = new Map(first.rows.map((row) => [row.participant_id, row.final_rank]));
	const favorites = new Set(first.rows.filter((row) => row.final_rank <= 3).map((row) => row.participant_id));
	let giant = null;
	for (const round of sorted.slice(1)) {
		const fallen = round.rows.filter((row) => favorites.has(row.participant_id) && row.final_status === 'eliminated');
		for (const favorite of fallen) {
			for (const row of round.rows) {
				const rank = seed.get(row.participant_id) ?? 0;
				// A igual revelación, se nombra al favorito mejor preclasificado.
				const favoriteSeed = seed.get(favorite.participant_id);
				const better = !giant || rank > giant.seed || (rank === giant.seed && favoriteSeed < giant.favoriteSeed);
				if (row.final_rank < favorite.final_rank && rank > 3 && better) {
					giant = { row, seed: rank, favoriteSeed, beaten: favorite.display_name, round: round.round_number };
				}
			}
		}
	}
	if (giant) {
		awards.push({
			id: 'matagigantes',
			title: 'El Matagigantes',
			description: 'El jugador revelación que dejó afuera a uno de los grandes favoritos.',
			winner: who(giant.row),
			detail: `Preclasificado ${giant.seed}.º, quedó por encima de ${giant.beaten} en la ronda ${giant.round}.`,
		});
	}

	// Superviviente: más rondas clasificadas sin resolver (por desempate).
	const survivals = new Map();
	for (const round of sorted) {
		for (const row of round.rows) {
			if (row.final_status === 'advanced' && !row.solved_at) {
				const previous = survivals.get(row.participant_id);
				survivals.set(row.participant_id, { row, count: (previous?.count ?? 0) + 1 });
			}
		}
	}
	const survivor = [...survivals.values()].sort((a, b) => b.count - a.count)[0];
	if (survivor) {
		awards.push({
			id: 'superviviente',
			title: 'Superviviente',
			description: 'Clasificó sin resolver: el cupo no se llenó y pasó por desempate.',
			winner: who(survivor.row),
			detail: `Sobrevivió ${survivor.count} ${survivor.count === 1 ? 'ronda' : 'rondas'} sin completar el problema.`,
		});
	}

	// El Verdugo: más rondas ganadas por la vía rápida (1.º en resolver).
	const firsts = new Map();
	for (const round of sorted) {
		const leader = round.rows.find((row) => row.final_rank === 1 && row.solved_at);
		if (leader) {
			const previous = firsts.get(leader.participant_id);
			firsts.set(leader.participant_id, { row: leader, count: (previous?.count ?? 0) + 1 });
		}
	}
	const executioner = [...firsts.values()].sort((a, b) => b.count - a.count)[0];
	if (executioner) {
		awards.push({
			id: 'verdugo',
			title: 'El Verdugo',
			description: 'Más rondas ganadas por la vía rápida: primero en resolver.',
			winner: who(executioner.row),
			detail: `Fue el primero en resolver en ${executioner.count} ${executioner.count === 1 ? 'ronda' : 'rondas'}.`,
		});
	}

	const accepted = submissions
		.filter((sub) => sub.verdict === 'accepted')
		.sort((a, b) => iso(a.submitted_at).localeCompare(iso(b.submitted_at)));

	// El Rayo del AC: el primer Accepted del torneo.
	const firstAccepted = accepted.find((sub) => rowOf(sub.round_number, sub.participant_id));
	if (firstAccepted) {
		const round = sorted.find((r) => r.round_number === firstAccepted.round_number);
		awards.push({
			id: 'rayo',
			title: 'El Rayo del AC',
			description: 'El primer Accepted del torneo: el globo verde inicial.',
			winner: who(rowOf(firstAccepted.round_number, firstAccepted.participant_id)),
			detail: `Accepted a los ${clock(secondsBetween(round.started_at, firstAccepted.submitted_at))} de la ronda ${round.round_number}.`,
		});
	}

	// Compilador O(1) Humano: el aceptado con menor tiempo de ejecución.
	const fastest = accepted
		.filter((sub) => sub.exec_ms !== null && sub.exec_ms !== undefined && rowOf(sub.round_number, sub.participant_id))
		.sort((a, b) => a.exec_ms - b.exec_ms)[0];
	if (fastest) {
		awards.push({
			id: 'o1',
			title: 'Compilador O(1) Humano',
			description: 'La solución más rápida en los servidores del juez.',
			winner: who(rowOf(fastest.round_number, fastest.participant_id)),
			detail: `${fastest.exec_ms} ms de ejecución en la ronda ${fastest.round_number}.`,
		});
	}

	// Amigo del Penalizador: más envíos fallidos en un mismo problema.
	let friend = null;
	for (const round of sorted) {
		for (const row of round.rows) {
			if (!friend || row.failed_attempts_count > friend.fails) {
				friend = { row, fails: row.failed_attempts_count, round: round.round_number };
			}
		}
	}
	if (friend && friend.fails > 0) {
		awards.push({
			id: 'penalizador',
			title: 'Amigo del Penalizador',
			description: 'No se rindió: más envíos fallidos en un solo problema.',
			winner: who(friend.row),
			detail: `${friend.fails} envíos fallidos en la ronda ${friend.round}${friend.row.solved_at ? ', y lo sacó' : ', con honor'}.`,
		});
	}

	// GMA: el ganador del torneo, al final de la ceremonia.
	const champion = final.rows.find((row) => row.final_status === 'advanced');
	if (champion && final.rows.filter((row) => row.final_status === 'advanced').length === 1) {
		awards.push({
			id: 'gma',
			title: 'GMA · Gran Maestro del Algoritmo',
			description: 'El ganador del torneo.',
			winner: who(champion),
			detail: `Último en pie de ${first.rows.length} corredores, en ${sorted.length} ${sorted.length === 1 ? 'ronda' : 'rondas'}.`,
		});
	}
	return awards;
}

module.exports = { computeAwards };
