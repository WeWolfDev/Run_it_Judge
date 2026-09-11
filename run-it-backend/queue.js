const { Queue, Worker } = require('bullmq');
const { runTestCases } = require('./judge0-client');

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
      const results = await runTestCases(job.data.code, job.data.language, job.data.testCases);
      return processSubmission({ ...job.data, results });
    },
    { connection, concurrency: Number(process.env.SUBMISSION_CONCURRENCY || 4) },
  );
}

module.exports = { submissionQueue, startSubmissionWorker };
