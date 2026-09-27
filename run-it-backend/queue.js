const { Queue, Worker } = require('bullmq');
const { createSubmission, waitForSubmission } = require('./judge0-client');

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};

const submissionQueue = new Queue('run-it-submissions', {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});

function startSubmissionWorker(loadTestCases, processSubmission) {
  return new Worker(
    'run-it-submissions',
    async (job) => {
      const testCases = await loadTestCases(job.data);
      if (testCases === null) return null;
      // Opción A en serie: una submission por caso, así cada job ocupa un solo slot y Judge0 (COUNT=8) nunca ve más de SUBMISSION_CONCURRENCY a la vez, por muchos participantes que haya.
      const results = [];
      for (const testCase of testCases) {
        const created = await createSubmission(job.data.code, job.data.language, testCase.stdin);
        const result = await waitForSubmission(created.token);
        results.push({ result, token: created.token });
      }
      return processSubmission({ ...job.data, testCases, results });
    },
    { connection, concurrency: Number(process.env.SUBMISSION_CONCURRENCY || 4) },
  );
}

module.exports = { submissionQueue, startSubmissionWorker };
