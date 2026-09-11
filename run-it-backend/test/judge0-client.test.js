const test = require('node:test');
const assert = require('node:assert/strict');

const { createBatchSubmissions, runTestCases } = require('../judge0-client');

function mockFetch(handlers) {
	const calls = [];
	let index = 0;
	globalThis.fetch = async (url, options) => {
		const call = { url: String(url), options };
		calls.push(call);
		const handler = handlers[Math.min(index, handlers.length - 1)];
		index += 1;
		if (!handler) throw new Error('fetch inesperado: ' + url);
		return handler(url, options, call);
	};
	return calls;
}

const jsonResponse = (status, body) => ({
	ok: status < 400,
	status,
	json: async () => body,
});

test('batch submissions encode source and stdin in base64', async () => {
	const calls = mockFetch([
		(_url, _options, call) => {
			const body = JSON.parse(call.options.body);
			assert.equal(call.url, 'http://localhost:2358/submissions/batch?base64_encoded=true&wait=false');
			assert.equal(body.submissions.length, 2);
			assert.equal(
				Buffer.from(body.submissions[0].source_code, 'base64').toString('utf8'),
				'print("hola")',
			);
			assert.equal(
				Buffer.from(body.submissions[1].stdin, 'base64').toString('utf8'),
				'entrada\n',
			);
			return jsonResponse(201, [{ token: 't1' }, { token: 't2' }]);
		},
		(_url, _options, call) => {
			const token = call.url.split('/submissions/')[1].split('?')[0];
			return jsonResponse(200, { token, status: { id: 3 }, stdout: token === 't1' ? 'a\n' : 'b\n' });
		},
	]);

	const results = await runTestCases('print("hola")', 'python', [{ stdin: '' }, { stdin: 'entrada\n' }]);

	assert.deepEqual(results.map((r) => r.stdout), ['a\n', 'b\n']);
	assert.equal(calls.length, 3);
});

test('runs nothing when the problem has no test cases', async () => {
	const calls = mockFetch([]);
	const results = await runTestCases('print(1)', 'python', []);

	assert.deepEqual(results, []);
	assert.equal(calls.length, 0);
});

test('falls back to sequential submissions when the batch endpoint is missing', async () => {
	const calls = mockFetch([
		(_url, _options, call) => {
			assert.match(call.url, /\/submissions\/batch/);
			return jsonResponse(404, { error: 'not found' });
		},
		(_url, _options, call) => {
			assert.match(call.url, /\/submissions\?base64_encoded=false/);
			const body = JSON.parse(call.options.body);
			assert.equal(body.stdin, 'uno');
			return jsonResponse(201, { token: 's1' });
		},
		() => jsonResponse(200, { token: 's1', status: { id: 3 }, stdout: 'uno' }),
		(_url, _options, call) => {
			const body = JSON.parse(call.options.body);
			assert.equal(body.stdin, 'dos');
			return jsonResponse(201, { token: 's2' });
		},
		() => jsonResponse(200, { token: 's2', status: { id: 3 }, stdout: 'dos' }),
	]);

	const results = await runTestCases('print(input())', 'python', [{ stdin: 'uno' }, { stdin: 'dos' }]);

	assert.deepEqual(results.map((r) => r.stdout), ['uno', 'dos']);
	assert.equal(calls.length, 5);
});

test('batch endpoint sends one submission per test case for the same language', async () => {
	const calls = mockFetch([
		(_url, _options, call) => {
			const body = JSON.parse(call.options.body);
			assert.equal(body.submissions.length, 3);
			assert.equal(body.submissions[0].language_id, 63);
			assert.equal(body.submissions[2].stdin, Buffer.from('').toString('base64'));
			return jsonResponse(201, [{ token: 'x1' }, { token: 'x2' }, { token: 'x3' }]);
		},
		() => jsonResponse(200, { token: 'x1', status: { id: 3 }, stdout: '' }),
	]);

	await runTestCases('console.log(1)', 'javascript', [{}, { stdin: 'z' }, { stdin: '' }]);

	assert.equal(calls.length, 4);
});