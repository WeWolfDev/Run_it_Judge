CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL,
  access_code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'participant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La identidad de un usuario es su código (access_code UNIQUE), no su nombre: el
-- login busca por los dos. El UNIQUE global de username no protegía nada y
-- dejaba afuera para siempre al segundo "Juan", aunque fuera de otro torneo. Se
-- busca por columna y no por nombre: Postgres lo nombró solo al crear la tabla.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT con.conname FROM pg_constraint con
    WHERE con.conrelid = 'users'::regclass
      AND con.contype = 'u'
      AND con.conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'users'::regclass AND attname = 'username'
      )]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END
$$;

-- El nombre del admin sí es único: db.js lo crea con ON CONFLICT sobre este
-- índice. Los participantes pueden repetir nombre entre ellos.
CREATE UNIQUE INDEX IF NOT EXISTS users_admin_username_key ON users (username) WHERE role = 'admin';
-- Reemplaza al índice que venía con el UNIQUE: el login filtra por username.
CREATE INDEX IF NOT EXISTS users_username_idx ON users (username);

-- El admin no se borra por ningún camino: ni endpoint, ni cascada, ni un DELETE
-- a mano. Tampoco se lo degrada a participante, que es la forma de volverlo
-- borrable. Sin esto, borrarlo deja el panel sin acceso hasta el próximo
-- reinicio, y ahí vuelve con el ADMIN_ACCESS_CODE de secrets.
CREATE OR REPLACE FUNCTION users_protect_admin() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'admin' AND (TG_OP = 'DELETE' OR NEW.role IS DISTINCT FROM 'admin') THEN
    RAISE EXCEPTION 'El usuario admin % no se puede borrar ni degradar', OLD.username
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
CREATE OR REPLACE TRIGGER users_protect_admin
  BEFORE DELETE OR UPDATE OF role ON users
  FOR EACH ROW EXECUTE FUNCTION users_protect_admin();

CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'claimed', 'expired')),
  claimed_by_user_id UUID REFERENCES users(id),
  display_name TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Tournament this code was minted for. NULL keeps the legacy behaviour:
  -- a global code with no automatic expiry.
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  -- Wall-clock deadline. A code past this instant stops validating even if the
  -- row still says 'unused', so no cron or reaper job is needed.
  expires_at TIMESTAMPTZ
);

-- tournaments is created after access_codes in this file, so the foreign key
-- above is added once the referenced table exists.
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS tournament_id UUID;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'access_codes_tournament_id_fkey'
  ) THEN
    ALTER TABLE access_codes
      ADD CONSTRAINT access_codes_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE;
  END IF;
END
$$;

-- Widen the status CHECK so codes can be marked 'expired'. ALTER ... DROP IF
-- EXISTS keeps this re-runnable against databases created before the change.
ALTER TABLE access_codes DROP CONSTRAINT IF EXISTS access_codes_status_check;
ALTER TABLE access_codes
  ADD CONSTRAINT access_codes_status_check
  CHECK (status IN ('unused', 'claimed', 'expired'));

CREATE INDEX IF NOT EXISTS access_codes_tournament_status_idx
  ON access_codes(tournament_id, status);
CREATE INDEX IF NOT EXISTS access_codes_expires_at_idx
  ON access_codes(expires_at) WHERE status = 'unused';

CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'finished')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS problems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  statement TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'easy' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  test_cases JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cada caso lleva is_sample. Los problemas anteriores a la columna se migran a
-- is_sample = false: nada que era privado se vuelve público sin que el admin lo
-- marque. Solo toca elementos sin la clave, así que tras la primera pasada el
-- WHERE no encuentra filas y nunca pisa lo que eligió el admin.
UPDATE problems p
SET test_cases = (
  SELECT jsonb_agg(
           CASE WHEN jsonb_typeof(tc) <> 'object' OR tc ? 'is_sample' THEN tc
                ELSE tc || '{"is_sample": false}'::jsonb END
           ORDER BY ord)
  FROM jsonb_array_elements(p.test_cases) WITH ORDINALITY AS t(tc, ord)
)
WHERE jsonb_typeof(p.test_cases) = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(p.test_cases) AS e(tc)
    WHERE jsonb_typeof(tc) = 'object' AND NOT tc ? 'is_sample'
  );

CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  problem_id UUID REFERENCES problems(id) ON DELETE SET NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  time_limit_seconds INTEGER NOT NULL CHECK (time_limit_seconds > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'closing', 'closed')),
  paused BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  UNIQUE (tournament_id, round_number)
);

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT false;

-- Fin de la cuenta regresiva previa a la ronda: hasta ese instante no se aceptan
-- envíos. Las rondas anteriores a la columna quedan en NULL, que significa "sin
-- cuenta regresiva", así que nadie queda bloqueado en una ronda ya en curso.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;

-- Nivel de dificultad de la ronda: en el panel filtra los problemas que se
-- ofrecen para ella. NULL en las rondas anteriores a la columna.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS difficulty TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rounds_difficulty_check') THEN
    ALTER TABLE rounds ADD CONSTRAINT rounds_difficulty_check
      CHECK (difficulty IS NULL OR difficulty IN ('easy', 'medium', 'hard'));
  END IF;
END
$$;

-- Borrar un problema no borra las rondas que lo usaron: quedan con problem_id
-- NULL y conservan número, estado, tiempos, participantes y envíos. Para que el
-- historial siga siendo legible se guarda el nombre del problema en la ronda.
-- DELETE /problems/:id lo vuelve a copiar antes de borrar; esta pasada cubre
-- las rondas anteriores a la columna y los renombres. IS DISTINCT FROM deja el
-- UPDATE sin filas en los arranques siguientes.
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS problem_name TEXT;
UPDATE rounds r SET problem_name = p.name
FROM problems p
WHERE p.id = r.problem_id AND r.problem_name IS DISTINCT FROM p.name;

-- problem_id pasa a opcional y su FK a ON DELETE SET NULL. Nunca CASCADE: se
-- llevaría la ronda y, detrás, los envíos y el historial del torneo. La FK se
-- busca por tabla y columna, no por nombre: la nombró Postgres.
ALTER TABLE rounds ALTER COLUMN problem_id DROP NOT NULL;
DO $$
DECLARE
  fk RECORD;
  problem_attnum SMALLINT;
BEGIN
  SELECT attnum INTO problem_attnum FROM pg_attribute
  WHERE attrelid = 'rounds'::regclass AND attname = 'problem_id';
  FOR fk IN
    SELECT conname, confdeltype FROM pg_constraint
    WHERE conrelid = 'rounds'::regclass
      AND contype = 'f'
      AND confrelid = 'problems'::regclass
      AND conkey = ARRAY[problem_attnum]
  LOOP
    -- 'n' = SET NULL: ya migrada.
    IF fk.confdeltype <> 'n' THEN
      EXECUTE format('ALTER TABLE rounds DROP CONSTRAINT %I', fk.conname);
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'rounds'::regclass
      AND contype = 'f'
      AND confrelid = 'problems'::regclass
      AND conkey = ARRAY[problem_attnum]
  ) THEN
    ALTER TABLE rounds
      ADD CONSTRAINT rounds_problem_id_fkey
      FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE SET NULL;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'eliminated', 'winner')),
  UNIQUE (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS round_participants (
  round_id UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  best_pass_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
  solved_at TIMESTAMPTZ,
  failed_attempts_count INTEGER NOT NULL DEFAULT 0,
  final_rank INTEGER,
  final_status TEXT CHECK (final_status IN ('advanced', 'eliminated')),
  PRIMARY KEY (round_id, participant_id)
);

-- 30 s por envío fallido antes de resolver. Solo desempata a igual solved_at.
ALTER TABLE round_participants ADD COLUMN IF NOT EXISTS penalty_seconds INTEGER NOT NULL DEFAULT 0;

-- Personaje elegido en el carrusel (0..9). Es por torneo, como participants:
-- se fija en la primera inscripción y el join no lo pisa en las siguientes.
ALTER TABLE participants ADD COLUMN IF NOT EXISTS character INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES rounds(id),
  participant_id UUID NOT NULL REFERENCES participants(id),
  code TEXT NOT NULL,
  language TEXT NOT NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  test_cases_passed INTEGER NOT NULL DEFAULT 0,
  test_cases_total INTEGER NOT NULL DEFAULT 0,
  verdict TEXT NOT NULL DEFAULT 'queued',
  judge0_token TEXT
);

-- Detalle por caso: [{ "passed": bool, "status": text }], sin stdin ni expected.
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS case_results JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Tiempo de ejecución del juez en ms: el mayor entre los casos. NULL en envíos
-- anteriores a la columna o sin tiempo. Lo usa el premio "Compilador O(1) Humano".
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS exec_ms INTEGER;

-- Ceremonia de premios al terminar el torneo (awards.js). ceremony_step: NULL =
-- pantalla del ganador, 0 = presentación, 1..N = premio N, N+1 = fin.
-- ceremony_updated_at marca cuándo avanzó el admin: la revelación de cada premio
-- se calcula desde ahí, así quien entra tarde lo ve ya revelado.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ceremony_step INTEGER;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS ceremony_updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS rounds_active_idx ON rounds(status);
CREATE INDEX IF NOT EXISTS submissions_participant_idx ON submissions(participant_id, submitted_at);
-- /queue/stats y la lista de envíos del panel cuentan y filtran por ronda.
CREATE INDEX IF NOT EXISTS submissions_round_idx ON submissions(round_id, verdict);
