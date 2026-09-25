#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const secretsFile = process.env.RUN_IT_SECRETS_FILE
  ? path.resolve(process.env.RUN_IT_SECRETS_FILE)
  : path.join(repoRoot, "run-it-backend", "secrets");
const apiUrl = (process.env.RUN_IT_API_URL || "http://127.0.0.1:3001").replace(/\/$/, "");
const keepData = process.env.E2E_KEEP_DATA === "1";
const apiHost = new URL(apiUrl).hostname;
if (!["127.0.0.1", "localhost", "::1"].includes(apiHost) && process.env.E2E_ALLOW_REMOTE !== "1") {
  throw new Error("Para una API remota define explicitamente E2E_ALLOW_REMOTE=1");
}

function readEnvironment(file) {
  const values = {};
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

async function request(pathname, { token, method = "GET", body } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = payload?.error || `HTTP ${response.status}`;
    throw new Error(`${method} ${pathname}: ${message}`);
  }
  return payload;
}

function waitForEvent(socket, event, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout esperando Socket.IO ${event}`));
    }, timeoutMs);
    const handler = (payload) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler);
  });
}

function connectSocket() {
  const { io } = require(path.join(repoRoot, "frontend", "node_modules", "socket.io-client"));
  return io(apiUrl, {
    transports: ["websocket", "polling"],
    timeout: 10_000,
  });
}

async function waitForConnect(socket) {
  if (socket.connected) return;
  await Promise.race([
    waitForEvent(socket, "connect", 10_000),
    new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout conectando Socket.IO")), 10_500)),
  ]);
}

async function waitForVerdict(database, submissionId) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await database.query(
      "SELECT verdict FROM submissions WHERE id = $1",
      [submissionId],
    );
    const verdict = result.rows[0]?.verdict;
    if (verdict && verdict !== "queued") return verdict;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Timeout esperando el veredicto de Judge0");
}

async function removeQueueJobs(submissionId) {
  const { Queue } = require(path.join(repoRoot, "run-it-backend", "node_modules", "bullmq"));
  const queue = new Queue("run-it-submissions", {
    connection: {
      host: process.env.REDIS_HOST || "127.0.0.1",
      port: Number(process.env.REDIS_PORT || 6380),
      password: process.env.REDIS_PASSWORD,
    },
  });
  try {
    const jobs = await queue.getJobs(["active", "waiting", "completed", "failed", "delayed"]);
    await Promise.all(
      jobs.filter((job) => job.data.submissionId === submissionId).map((job) => job.remove()),
    );
  } finally {
    await queue.close();
  }
}

async function main() {
  const environment = readEnvironment(secretsFile);
  for (const key of ["DATABASE_URL", "REDIS_PASSWORD", "ADMIN_USERNAME", "ADMIN_ACCESS_CODE"]) {
    if (!environment[key]) throw new Error(`Falta ${key} en ${secretsFile}`);
  }
  process.env.REDIS_HOST = environment.REDIS_HOST || "127.0.0.1";
  process.env.REDIS_PORT = environment.REDIS_PORT || "6380";
  process.env.REDIS_PASSWORD = environment.REDIS_PASSWORD;

  const { Client } = require(path.join(repoRoot, "run-it-backend", "node_modules", "pg"));
  const database = new Client({
    connectionString: environment.DATABASE_URL,
    application_name: "run-it-e2e",
  });
  await database.connect();

  let socket;
  let adminToken;
  let participantToken;
  let problemId;
  let tournamentId;
  let roundId;
  let participantId;
  let participantUserId;
  let accessCode;
  let submissionId;
  let cleanupComplete = keepData;

  const cleanupRecords = async () => {
    if (submissionId) {
      await removeQueueJobs(submissionId).catch(() => undefined);
    }
    await database.query("BEGIN");
    try {
      if (submissionId) await database.query("DELETE FROM submissions WHERE id = $1", [submissionId]);
      if (roundId) await database.query("DELETE FROM rounds WHERE id = $1", [roundId]);
      if (participantUserId) {
        await database.query("DELETE FROM access_codes WHERE claimed_by_user_id = $1", [participantUserId]);
        await database.query("DELETE FROM participants WHERE user_id = $1", [participantUserId]);
        await database.query("DELETE FROM users WHERE id = $1", [participantUserId]);
      }
      if (tournamentId) await database.query("DELETE FROM tournaments WHERE id = $1", [tournamentId]);
      if (problemId) await database.query("DELETE FROM problems WHERE id = $1", [problemId]);
      await database.query("COMMIT");
    } catch (error) {
      await database.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  };

  try {
    console.log("1/8 Login administrativo");
    const admin = await request("/auth/login", {
      method: "POST",
      body: {
        username: environment.ADMIN_USERNAME || "admin",
        accessCode: environment.ADMIN_ACCESS_CODE,
      },
    });
    adminToken = admin.token;
    assert.equal(admin.user.role, "admin");

    const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    console.log("2/8 Crear problema y comprobar que el resumen publico no filtra tests");
    const problem = await request("/problems", {
      token: adminToken,
      method: "POST",
      body: {
        name: `E2E Saludo ${suffix}`,
        statement: "Imprime exactamente: Hola mundo",
        difficulty: "easy",
        testCases: [{ stdin: "", expected: "Hola mundo" }],
      },
    });
    problemId = problem.id;
    const publicProblem = await request(`/problems/${problemId}`);
    assert.equal(publicProblem.test_cases, undefined);

    console.log("3/8 Crear torneo, ronda y codigo de participante");
    const tournament = await request("/tournaments", {
      token: adminToken,
      method: "POST",
      body: { name: `E2E Run It ${suffix}` },
    });
    tournamentId = tournament.id;
    const round = await request("/rounds", {
      token: adminToken,
      method: "POST",
      body: {
        tournamentId,
        roundNumber: 1,
        problemId,
        capacity: 1,
        timeLimitSeconds: 180,
      },
    });
    roundId = round.id;
    const generated = await request("/access-codes/generate", {
      token: adminToken,
      method: "POST",
      body: { count: 1 },
    });
    accessCode = generated.codes[0];
    assert.match(accessCode, /^RUNIT-[0-9A-F]{16}$/);

    const participant = await request("/auth/register", {
      method: "POST",
      body: { username: `e2e-${suffix}`, accessCode },
    });
    participantToken = participant.token;
    participantUserId = participant.user.id;
    assert.equal(participant.user.role, "participant");

    await request(`/tournaments/${tournamentId}/start`, { token: adminToken, method: "POST" });
    await request(`/rounds/${roundId}/start`, { token: adminToken, method: "POST" });
    const joined = await request(`/rounds/${roundId}/participants/join`, {
      token: participantToken,
      method: "POST",
      body: { displayName: `Participante E2E ${suffix}` },
    });
    participantId = joined.id;

    console.log("4/8 Conectar Socket.IO y entrar en la sala de la ronda");
    socket = connectSocket();
    await waitForConnect(socket);
    socket.emit("round:join", roundId);
    await new Promise((resolve) => setTimeout(resolve, 150));

    console.log("5/8 Validar pausa y reanudacion en tiempo real");
    const pausedEvent = waitForEvent(socket, "round:paused");
    const pausedRound = await request(`/rounds/${roundId}/pause`, {
      token: adminToken,
      method: "POST",
    });
    assert.equal(pausedRound.paused, true);
    assert.equal((await pausedEvent).paused, true);
    const resumedEvent = waitForEvent(socket, "round:paused");
    const resumedRound = await request(`/rounds/${roundId}/pause`, {
      token: adminToken,
      method: "POST",
    });
    assert.equal(resumedRound.paused, false);
    assert.equal((await resumedEvent).paused, false);

    console.log("6/8 Enviar Python y comprobar accepted + Judge0");
    const queuedEvent = waitForEvent(socket, "submission:queued");
    const progressEvent = waitForEvent(socket, "participant:progress");
    const closedEvent = waitForEvent(socket, "round:closed");
    const submission = await request(`/rounds/${roundId}/submissions`, {
      token: participantToken,
      method: "POST",
      body: {
        participantId,
        code: 'print("Hola mundo")',
        language: "python",
      },
    });
    submissionId = submission.id;
    const publicQueueEvent = await queuedEvent;
    assert.equal(publicQueueEvent.id, submissionId);
    assert.equal(publicQueueEvent.code, undefined);
    assert.equal((await progressEvent).solved, true);
    const closePayload = await closedEvent;
    assert.equal(closePayload.ranking[0].final_status, "advanced");
    assert.equal(await waitForVerdict(database, submissionId), "accepted");

    const finalState = await request(`/rounds/${roundId}/state`);
    assert.equal(finalState.status, "closed");

    console.log("7/8 Cerrar sesiones Socket/API");
    await request("/auth/logout", { token: participantToken, method: "POST" });
    await request("/auth/logout", { token: adminToken, method: "POST" });
    socket.disconnect();
    socket = undefined;
    participantToken = undefined;
    adminToken = undefined;

    console.log("8/8 Limpiar datos de prueba");
    if (keepData) {
      console.log("E2E_KEEP_DATA=1: se conservaron los datos de prueba.");
    } else {
      await cleanupRecords();
      cleanupComplete = true;
      console.log("Datos E2E eliminados; la base conserva solo el administrador inicial.");
    }

    console.log("E2E OK: autenticación, CRUD, pausa, Socket.IO, Judge0, ranking y cierre.");
  } finally {
    socket?.disconnect();
    if (participantToken) {
      await request("/auth/logout", { token: participantToken, method: "POST" }).catch(() => undefined);
    }
    if (adminToken) {
      await request("/auth/logout", { token: adminToken, method: "POST" }).catch(() => undefined);
    }
    if (keepData) {
      console.log(`Datos conservados para inspeccion: tournament=${tournamentId} round=${roundId}`);
    } else if (!cleanupComplete && (roundId || problemId)) {
      await cleanupRecords().catch((error) => {
        console.error(`No se pudo limpiar la prueba E2E: ${error.message}`);
      });
    }
    await database.end();
  }
}

main().catch((error) => {
  console.error(`E2E FALLO: ${error.message}`);
  process.exitCode = 1;
});
