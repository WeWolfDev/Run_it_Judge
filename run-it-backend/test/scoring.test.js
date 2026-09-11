const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateSubmission } = require('../scoring');

const ok = (stdout) => ({ token: 't', status: { id: 3, description: 'Accepted' }, stdout });

test('all cases passing yields accepted and 100%', () => {
	const cases = [{ stdin: '', expected: 'Hola mundo' }, { stdin: 'x', expected: 'y' }];
	const results = [ok('Hola mundo\n'), ok('y')];
	const evaluation = evaluateSubmission(cases, results);

	assert.equal(evaluation.passed, 2);
	assert.equal(evaluation.total, 2);
	assert.equal(evaluation.percentage, 100);
	assert.equal(evaluation.solved, true);
	assert.equal(evaluation.verdict, 'accepted');
});

test('partial pass computes percentage and remaining attempts', () => {
	const cases = [{ stdin: '', expected: 'a' }, { stdin: '', expected: 'b' }];
	const results = [ok('a'), ok('c')];
	const evaluation = evaluateSubmission(cases, results);

	assert.equal(evaluation.passed, 1);
	assert.equal(evaluation.percentage, 50);
	assert.equal(evaluation.solved, false);
	assert.equal(evaluation.verdict, 'rejected (1/2 casos)');
});

test('partial pass with three cases keeps two decimals', () => {
	const cases = [{ expected: 'a' }, { expected: 'b' }, { expected: 'c' }];
	const evaluation = evaluateSubmission(cases, [ok('a'), ok('b'), ok('x')]);

	assert.equal(evaluation.percentage, 66.67);
});

test('compile error surfaces the judge description', () => {
	const cases = [{ stdin: '', expected: 'a' }];
	const results = [{ token: 't', status: { id: 6, description: 'Compilation error' } }];
	const evaluation = evaluateSubmission(cases, results);

	assert.equal(evaluation.solved, false);
	assert.equal(evaluation.passed, 0);
	assert.equal(evaluation.verdict, 'Compilation error');
});

test('time limit exceeded surfaces the judge description', () => {
	const cases = [{ stdin: '', expected: 'a' }];
	const results = [{ token: 't', status: { id: 5, description: 'Time Limit Exceeded' } }];
	const evaluation = evaluateSubmission(cases, results);

	assert.equal(evaluation.verdict, 'Time Limit Exceeded');
});

test('problem without test cases is never solved', () => {
	const evaluation = evaluateSubmission([], []);

	assert.equal(evaluation.total, 0);
	assert.equal(evaluation.percentage, 0);
	assert.equal(evaluation.solved, false);
	assert.equal(evaluation.verdict, 'rejected (0/0 casos)');
});

test('missing results are treated as failures', () => {
	const cases = [{ stdin: '', expected: 'a' }, { stdin: '', expected: 'b' }];
	const evaluation = evaluateSubmission(cases, [ok('a')]);

	assert.deepEqual([evaluation.passed, evaluation.total, evaluation.solved], [1, 2, false]);
});