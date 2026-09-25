const JUDGE0_URL = process.env.JUDGE0_URL || 'http://localhost:2358';
const requestTimeoutMs = Number(process.env.JUDGE0_REQUEST_TIMEOUT_MS || 10000);
const submissionTimeoutMs = Number(process.env.JUDGE0_SUBMISSION_TIMEOUT_MS || 30000);

async function requestJson(url, options) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(`Judge0 ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

const LANGUAGE_IDS = {
  python: 71,
  javascript: 63,
};

async function createSubmission(sourceCode, language, stdin = '') {
  const languageId = LANGUAGE_IDS[language.toLowerCase()] || Number(language);

  if (!Number.isInteger(languageId)) {
    throw new Error(`Lenguaje no soportado: ${language}`);
  }

  return requestJson(`${JUDGE0_URL}/submissions?base64_encoded=false&wait=false`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      language_id: languageId,
      source_code: sourceCode,
      stdin,
    }),
  });
}

async function getSubmission(token) {
  return requestJson(
    `${JUDGE0_URL}/submissions/${encodeURIComponent(token)}?base64_encoded=false`,
  );
}

async function waitForSubmission(token, options = {}) {
  const timeoutMs = Number(options.timeoutMs || submissionTimeoutMs);
  const pollIntervalMs = Number(options.pollIntervalMs || 500);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const submission = await getSubmission(token);

    if (submission.status?.id > 2) {
      return submission;
    }

    if (Date.now() >= deadline) {
      throw new Error(`Judge0 excedió el tiempo de espera de ${timeoutMs} ms`);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function main() {
  const created = await createSubmission('print("Judge0 conectado")', 'python');
  console.log('Submission creada:', created);

  const result = await waitForSubmission(created.token);
  if (result.status?.id !== 3 || result.stdout?.toString().trim() !== 'Judge0 conectado') {
    throw new Error(`Judge0 no ejecuto correctamente: ${JSON.stringify(result)}`);
  }
  console.log('Resultado:', result);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createSubmission, getSubmission, waitForSubmission };