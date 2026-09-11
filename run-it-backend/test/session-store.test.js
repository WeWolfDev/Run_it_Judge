const test = require('node:test');
const assert = require('node:assert/strict');

delete process.env.SESSION_STORE;

const { setSession, getSession, deleteSession, memorySessions } = require('../session-store');

test('sessions persist in memory and expire on delete', async () => {
	memorySessions.clear();
	const token = 'token-1';
	const user = { id: 'u1', username: 'demo', role: 'participant' };

	await setSession(token, user);
	assert.deepEqual(await getSession(token), user);

	await deleteSession(token);
	assert.equal(await getSession(token), null);
});

test('unknown tokens resolve to null', async () => {
	assert.equal(await getSession('no-existe'), null);
});