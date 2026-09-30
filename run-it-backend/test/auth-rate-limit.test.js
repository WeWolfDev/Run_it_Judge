// Limites de intentos de autenticacion. DB-free: solo se necesita que las
// consultas devuelvan cero filas, asi que todos estos intentos usan credenciales
// que no existen.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5432/test';
process.env.SESSION_STORE = 'memory';

const {
  fastify,
  AUTH_IDENTITY_LIMIT,
  AUTH_IP_LIMIT,
  recordAuthFailureForTest,
  clearAuthFailuresForTest,
  authFailureCountForTest,
  authLimitForTest,
} = require('../index');
const { pool } = require('../db');
const { submissionQueue } = require('../queue');

test('los limites por identidad y por IP estan separados y el de IP es mayor', () => {
  // La IP es una capa extra: en un torneo las 50 personas comparten la del Wi-Fi,
  // asi que su tope tiene que ser holgado. El que protege la cuenta es el de
  // identidad.
  assert.equal(AUTH_IDENTITY_LIMIT, 5);
  assert.equal(AUTH_IP_LIMIT, 200);
  assert.ok(AUTH_IP_LIMIT > AUTH_IDENTITY_LIMIT, 'el tope por IP debe superar al de identidad');
});

test('la IP aplica su propio tope, no el de identidad', () => {
  // Este era el defecto: ambos contadores usaban el mismo limite, asi que 5
  // tecleos de cualquiera de los 50 participantes bloqueaban a los 50.
  assert.equal(authLimitForTest('ip:203.0.113.5'), AUTH_IP_LIMIT);
  assert.equal(authLimitForTest('identity:alguien'), AUTH_IDENTITY_LIMIT);
});

test('una IP compartida aguanta dos rondas completas de tecleos', () => {
  // 50 personas equivocandose una vez cada una, dos veces: 100 fallos. Tiene que
  // caber en el tope por IP, si no el torneo se cae en la primera ronda.
  assert.ok(AUTH_IP_LIMIT >= 100, 'el tope por IP debe absorber 100 fallos de una ronda');
});

test('un acierto libera los contadores de identidad y de IP', () => {
  // DB-free: se ejercita clearAuthFailuresForRequest directamente, que es donde
  // estaba el defecto. Con la base delante, el caso se cubre en el E2E.
  const sharedIp = '198.51.100.55';
  recordAuthFailureForTest({ ip: sharedIp }, 'alguien-que-se-equivoca');
  recordAuthFailureForTest({ ip: sharedIp }, 'otro-que-se-equivoca');
  assert.equal(authFailureCountForTest(`ip:${sharedIp}`), 2, 'los fallos se contaron');

  clearAuthFailuresForTest({ ip: sharedIp }, 'alguien-que-se-equivoca');
  assert.equal(authFailureCountForTest(`ip:${sharedIp}`), 0, 'el acierto debe liberar la IP');
  assert.equal(authFailureCountForTest('identity:alguien-que-se-equivoca'), 0, 'y la identidad');
});

test('el limite por identidad sigue frenando la fuerza bruta contra una cuenta', () => {
  const attackerIp = '198.51.100.66';
  for (let i = 0; i < AUTH_IDENTITY_LIMIT; i += 1) {
    recordAuthFailureForTest({ ip: attackerIp }, 'atacante');
  }
  // Aunque la IP largementea margen, la cuenta concreta ya esta bloqueada: la
  // proteccion que importa no dependia de la IP compartida.
  assert.equal(authFailureCountForTest('identity:atacante'), AUTH_IDENTITY_LIMIT);
  assert.equal(authFailureCountForTest('identity:atacante') >= authLimitForTest('identity:atacante'), true);
});

test('un acierto borra la IP, pero la identidad ya bloqueada se mantiene hasta su acierto', () => {
  // Un acierto limpia la IP compartida. Es el precio consciente de no bloquear a
  // 50 personas por el error de una, y el limite por identidad sigue en pie.
  // Nombre propio: el mapa de fallos es global al proceso y las pruebas comparten
  // estado, asi que una identidad repetida arrastra el conteo anterior.
  const sharedIp = '198.51.100.77';
  const target = 'atacante-de-otra-prueba';
  recordAuthFailureForTest({ ip: sharedIp }, target);
  assert.equal(authFailureCountForTest(`identity:${target}`), 1);
  clearAuthFailuresForTest({ ip: sharedIp }, 'usuario-legitimo');
  assert.equal(authFailureCountForTest(`ip:${sharedIp}`), 0, 'la IP se libera');
  // El atacante no se ve afectado por el acierto de otro: su cuenta sigue con su
  // conteo, protegido por el limite de identidad.
  assert.equal(authFailureCountForTest(`identity:${target}`), 1, 'la identidad del atacante no se toca');
});

test.after(async () => {
  await fastify.close();
  await submissionQueue.close();
  await pool.end();
});
