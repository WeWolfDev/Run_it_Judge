// Presupuesto de ejecuciones en vuelo contra Judge0, compartido por todos los
// jobs del proceso. Cada tarea toma un permiso, corre y lo devuelve en el
// finally, así que una excepción no se lleva el permiso. Nadie pide un segundo
// permiso mientras tiene uno: no hay orden de adquisición y no hay deadlock.
function createLimiter(max) {
	if (!Number.isInteger(max) || max < 1) {
		throw new Error(`Presupuesto de Judge0 inválido: ${max}`);
	}
	let active = 0;
	const waiting = [];
	return {
		max,
		async run(task) {
			if (active < max) active += 1;
			else await new Promise((resolve) => waiting.push(resolve));
			try {
				return await task();
			} finally {
				// El permiso pasa directo al siguiente en la fila: active no baja.
				const next = waiting.shift();
				if (next) next();
				else active -= 1;
			}
		},
		stats() {
			return { active, waiting: waiting.length };
		},
	};
}

// Corre los casos en paralelo dentro del presupuesto. results[i] es siempre el
// resultado de testCases[i]: se escribe por índice, nunca con push, porque
// case_results se atribuye por posición y un desorden no da ningún error.
//
// Si un caso falla no se lanzan más, pero se espera a los que ya están en
// Judge0 antes de rechazar: así el reintento de BullMQ no se superpone con
// ejecuciones del intento anterior.
async function runTestCases(testCases, runCase, limiter) {
	const results = new Array(testCases.length);
	let next = 0;
	let failed = false;
	const lane = async () => {
		while (!failed && next < testCases.length) {
			const index = next++;
			await limiter.run(async () => {
				if (failed) return;
				try {
					results[index] = await runCase(testCases[index], index);
				} catch (error) {
					failed = true;
					throw error;
				}
			});
		}
	};
	const lanes = Array.from({ length: Math.min(testCases.length, limiter.max) }, lane);
	const settled = await Promise.allSettled(lanes);
	const rejected = settled.find((outcome) => outcome.status === 'rejected');
	if (rejected) throw rejected.reason;
	return results;
}

module.exports = { createLimiter, runTestCases };
