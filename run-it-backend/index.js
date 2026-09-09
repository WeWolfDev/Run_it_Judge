const fastify = require('fastify')({ logger: true });
const { createSubmission, waitForSubmission } = require('./judge0-client');

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.post('/submissions', async (request, reply) => {
	const { code, language, problemId } = request.body || {};

	if (!code || !language || !problemId) {
		return reply.code(400).send({ error: 'code, language y problemId son obligatorios' });
	}

	if (problemId !== 'hola-mundo') {
		return reply.code(400).send({ error: 'Solo está disponible el problema hola-mundo' });
	}

	try {
		const created = await createSubmission(code, language);
		const result = await waitForSubmission(created.token);
		const verdict = result.status?.id === 3 && result.stdout?.trim() === 'Hola mundo'
			? 'accepted'
			: result.status?.description || 'rejected';

		return { verdict, token: created.token, result };
	} catch (error) {
		return reply.code(502).send({ error: error.message });
	}
});

fastify.listen({ port: 3000, host: '127.0.0.1' }).catch((error) => {
	fastify.log.error(error);
	process.exit(1);
});
