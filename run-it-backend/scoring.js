function evaluateSubmission(testCases, results) {
	const cases = Array.isArray(testCases) ? testCases : [];
	const total = cases.length;
	let passed = 0;
	let failureDescription = null;

	for (let index = 0; index < total; index += 1) {
		const result = results?.[index];
		const expected = (cases[index]?.expected ?? '').toString().trim();
		const actual = result?.stdout?.toString().trim() ?? '';
		const statusId = result?.status?.id;
		const ok = statusId === 3 && expected !== '' && actual === expected;

		if (!ok && failureDescription === null) {
			failureDescription = statusId === 3 || statusId === 4
				? null
				: (result?.status?.description || 'rejected');
		}

		if (ok) passed += 1;
	}

	const solved = total > 0 && passed === total;
	const percentage = total === 0 ? 0 : Math.round((passed / total) * 10000) / 100;
	const verdict = solved
		? 'accepted'
		: (failureDescription || `rejected (${passed}/${total} casos)`);

	return { passed, total, percentage, solved, verdict };
}

module.exports = { evaluateSubmission };