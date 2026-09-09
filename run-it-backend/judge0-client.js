const JUDGE0_URL = process.env.JUDGE0_URL || 'http://localhost:2358';

async function requestJson(url, options) {
  const response = await fetch(url, options);
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

async function createSubmission(sourceCode, language) {
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
    }),
  });
}

async function getSubmission(token) {
  return requestJson(
    `${JUDGE0_URL}/submissions/${encodeURIComponent(token)}?base64_encoded=false`,
  );
}

async function waitForSubmission(token) {
  for (;;) {
    const submission = await getSubmission(token);

    if (submission.status?.id > 2) {
      return submission;
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function main() {
  const created = await createSubmission('print("Judge0 conectado")', 'python');
  console.log('Submission creada:', created);

  const result = await waitForSubmission(created.token);
  console.log('Resultado:', result);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { createSubmission, getSubmission, waitForSubmission };