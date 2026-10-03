const { Queue, Worker } = require('bullmq');
const { createSubmission, waitForSubmission } = require('./judge0-client');
const { createLimiter, runTestCases } = require('./case-runner');

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

// Tope de ejecuciones simultáneas en Judge0 para todo el proceso, sumando los
// casos de todos los jobs. Igual a COUNT de judge0.conf: con más, Judge0 las
// encola y, pasadas MAX_QUEUE_SIZE, rechaza el POST y el envío termina en
// judge_error.
const judge0Slots = createLimiter(Number(process.env.JUDGE0_MAX_IN_FLIGHT || 8));

function startSubmissionWorker(loadTestCases, processSubmission) {
  return new Worker(
    'run-it-submissions',
    async (job) => {
      const testCases = await loadTestCases(job.data);
      if (testCases === null) return null;
      // Un envío de Judge0 por caso, para reportar cuántos pasaron. Los casos
      // van en paralelo dentro del tope compartido: un job solo puede usarlo
      // entero y, con más jobs, se lo reparten en orden de llegada.
      const results = await runTestCases(testCases, async (testCase) => {
        const created = await createSubmission(job.data.code, job.data.language, testCase.stdin);
        const result = await waitForSubmission(created.token);
        return { result, token: created.token };
      }, judge0Slots);
      return processSubmission({ ...job.data, testCases, results });
    },
    { connection, concurrency: Number(process.env.SUBMISSION_CONCURRENCY || 4) },
  );
}

module.exports = { submissionQueue, startSubmissionWorker, judge0Slots };
