const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUBMISSION_RATE_WINDOW_MS = '40';
delete process.env.SESSION_STORE;

const { allowSubmission, memoryHits } = require('../rate-limit');

test('first submission is allowed and the immediate next one is not', async () => {
	memoryHits.clear();
	const first = await allowSubmission('user-a');
	const second = await allowSubmission('user-a');

	assert.equal(first, true);
	assert.equal(second, false);
});

test('the window reopens after the configured interval', async () => {
	memoryHits.clear();
	await allowSubmission('user-b');
	await new Promise((resolve) => setTimeout(resolve, 60));
	const third = await allowSubmission('user-b');

	assert.equal(third, true);
});

test('limits are tracked per user', async () => {
	memoryHits.clear();
	const first = await allowSubmission('user-c');
	const other = await allowSubmission('user-d');

	assert.equal(first, true);
	assert.equal(other, true);
});