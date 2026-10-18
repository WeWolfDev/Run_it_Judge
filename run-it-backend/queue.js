const { Queue, Worker } = require('bullmq');
const { createSubmission, waitForSubmission } = require('./judge0-client');
const { createLimiter, runTestCases } = require('./case-runner');

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT || 6379),
  password: process.env.REDIS_PASSWORD || undefined,
};

// La cola se crea al primer uso, no al cargar el módulo: BullMQ abre la
// conexión a Redis en el constructor. Así un proceso que solo importa index.js
// (los tests DB-free) no conecta a Redis, y no queda una conexión a medio abrir
// al cerrar (EPIPE / ECONNREFUSED después de terminar el test). El servidor la
// crea igual enseguida: /ready y el primer envío la usan.
let queue = null;

function getQueue() {
  if (!queue) {
    queue = new Queue('run-it-submissions', {
      connection,
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
    // Sin oyente, un error de conexión de Redis sale como evento sin manejar.
    queue.on('error', (error) => console.error('[run-it] cola de envíos:', error.message));
  }
  return queue;
}

const submissionQueue = {
  add: (...args) => getQueue().add(...args),
  getJobCounts: (...args) => getQueue().getJobCounts(...args),
  /** Cierra la conexión si se llegó a abrir. */
  close: () => (queue ? queue.close() : Promise.resolve()),
};

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
