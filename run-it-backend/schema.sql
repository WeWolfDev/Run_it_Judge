CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT NOT NULL UNIQUE,
  access_code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'participant')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS access_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused', 'claimed')),
  claimed_by_user_id UUID REFERENCES users(id),
  display_name TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  problem_id UUID NOT NULL REFERENCES problems(id),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  time_limit_seconds INTEGER NOT NULL CHECK (time_limit_seconds > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'closing', 'closed')),
  paused BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  UNIQUE (tournament_id, round_number)
);

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

CREATE INDEX IF NOT EXISTS rounds_active_idx ON rounds(status);
CREATE INDEX IF NOT EXISTS submissions_participant_idx ON submissions(participant_id, submitted_at);
