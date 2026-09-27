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
  // GCC 9.2.0 de la instancia local. No usar 48/49/52/53 (GCC 7.4/8.3) ni 75/76 (Clang).
  c: 50,
  cpp: 54,
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

// GCC escribe comillas tipográficas en compile_output y Judge0 se niega a
// devolverlas en texto plano (400 "cannot be converted to UTF-8").
const BASE64_FIELDS = ['source_code', 'stdin', 'expected_output', 'stdout', 'stderr', 'compile_output', 'message'];

async function getSubmission(token) {
  const submission = await requestJson(
    `${JUDGE0_URL}/submissions/${encodeURIComponent(token)}?base64_encoded=true`,
  );
  for (const field of BASE64_FIELDS) {
    if (typeof submission[field] === 'string') {
      submission[field] = Buffer.from(submission[field], 'base64').toString('utf8');
    }
  }
  return submission;
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