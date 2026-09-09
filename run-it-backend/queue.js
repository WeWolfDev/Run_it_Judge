const { Queue, Worker } = require('bullmq');
const { createSubmission, waitForSubmission } = require('./judge0-client');

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};

const submissionQueue = new Queue('run-it-submissions', { connection });

function startSubmissionWorker(processSubmission) {
  return new Worker(
    'run-it-submissions',
    async (job) => {
      const created = await createSubmission(job.data.code, job.data.language);
      const result = await waitForSubmission(created.token);
      return processSubmission({ ...job.data, result, token: created.token });
    },
    { connection, concurrency: Number(process.env.SUBMISSION_CONCURRENCY || 4) },
  );
}

module.exports = { submissionQueue, startSubmissionWorker };
