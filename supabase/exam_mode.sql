-- ═══════════════════════════════════════════════════════════════════════════
-- EXAM MODE — secure sittings, generated credentials, server-side scoring
--
-- Security model
-- --------------
-- The three tables below are fully locked. Anon and authenticated roles have
-- no direct table access at all. The ONLY way a candidate can touch this data
-- is through the SECURITY DEFINER functions at the bottom of this file, and
-- none of those functions ever return correctAnswer.
--
-- This is what keeps the answer key out of the browser. A candidate can open
-- developer tools, read every network response, and inspect the entire JS
-- bundle without ever seeing which option is correct, because the answer key
-- is never sent to the client. Scoring happens inside Postgres.
-- ═══════════════════════════════════════════════════════════════════════════

-- Supabase installs pgcrypto into the `extensions` schema rather than `public`,
-- which is why every function below pins `search_path = public, extensions,
-- pg_temp`. Without `extensions` on that path, crypt() and gen_salt() are not
-- resolvable inside a SECURITY DEFINER function and both credential generation
-- and candidate login fail.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- The create-quiz form has always collected instructions but the API never
-- persisted them. Add the column if it is missing so exam papers can carry
-- their own rubric. Existing installs that already have it are left alone,
-- whatever its type, because exam_get_paper reads it through to_jsonb.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'exams' AND column_name = 'instructions'
  ) THEN
    ALTER TABLE exams ADD COLUMN instructions jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;

-- ── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS exam_sessions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id                   uuid        NOT NULL,
  title                     text        NOT NULL,
  session_code              text        NOT NULL UNIQUE,
  starts_at                 timestamptz,
  ends_at                   timestamptz,
  duration_minutes          integer     NOT NULL DEFAULT 60,
  status                    text        NOT NULL DEFAULT 'scheduled',  -- scheduled | live | closed
  show_results_to_candidate boolean     NOT NULL DEFAULT false,
  shuffle_questions         boolean     NOT NULL DEFAULT true,
  lock_to_device            boolean     NOT NULL DEFAULT true,
  max_tab_switches          integer     NOT NULL DEFAULT 3,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exam_candidates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid        NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  user_id            uuid,                              -- optional link to a platform account
  full_name          text        NOT NULL,
  school             text,
  grade              text,
  access_code        text        NOT NULL,
  password_hash      text        NOT NULL,
  -- Disposable per-sitting credential kept in clear so the admin can reprint a
  -- lost slip mid-exam. Never leaves the server: the table is RLS-locked and no
  -- candidate-facing function selects this column.
  password_plain     text        NOT NULL,
  token              uuid,
  token_issued_at    timestamptz,
  device_fingerprint text,
  question_order     integer[],
  answers            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status             text        NOT NULL DEFAULT 'pending',  -- pending | in_progress | submitted | disqualified
  started_at         timestamptz,
  expires_at         timestamptz,
  submitted_at       timestamptz,
  score              integer,
  total_questions    integer,
  tab_switches       integer     NOT NULL DEFAULT 0,
  last_seen_at       timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, access_code)
);

CREATE TABLE IF NOT EXISTS exam_events (
  id           bigserial PRIMARY KEY,
  candidate_id uuid        NOT NULL REFERENCES exam_candidates(id) ON DELETE CASCADE,
  type         text        NOT NULL,
  meta         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exam_candidates_session_idx ON exam_candidates(session_id);
CREATE INDEX IF NOT EXISTS exam_candidates_token_idx   ON exam_candidates(token);
CREATE INDEX IF NOT EXISTS exam_events_candidate_idx   ON exam_events(candidate_id, created_at DESC);

-- ── Lock everything down ───────────────────────────────────────────────────

ALTER TABLE exam_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_events     ENABLE ROW LEVEL SECURITY;

-- No policies are created, so RLS denies everything by default.
-- Revoke the implicit Supabase grants as well, belt and braces.
REVOKE ALL ON exam_sessions   FROM anon, authenticated;
REVOKE ALL ON exam_candidates FROM anon, authenticated;
REVOKE ALL ON exam_events     FROM anon, authenticated;

-- ── Internal helper: resolve a live token to a candidate row ────────────────

CREATE OR REPLACE FUNCTION _exam_resolve(p_token uuid)
RETURNS exam_candidates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE c exam_candidates;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE token = p_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your exam session is no longer valid. Ask the invigilator to sign you back in.';
  END IF;
  IF c.status = 'disqualified' THEN
    RAISE EXCEPTION 'This attempt has been stopped. Speak to your invigilator.';
  END IF;
  RETURN c;
END;
$$;

-- ── 1. Candidate login ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION exam_candidate_login(
  p_session_code text,
  p_access_code  text,
  p_password     text,
  p_fingerprint  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  s          exam_sessions;
  c          exam_candidates;
  new_token  uuid;
  n_questions integer;
BEGIN
  SELECT * INTO s FROM exam_sessions WHERE upper(session_code) = upper(trim(p_session_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'We could not find that exam. Check the link and try again.';
  END IF;

  IF s.status = 'closed' THEN
    RAISE EXCEPTION 'This exam has closed.';
  END IF;
  IF s.starts_at IS NOT NULL AND now() < s.starts_at THEN
    RAISE EXCEPTION 'This exam has not opened yet. It starts at %.', to_char(s.starts_at, 'DD Mon YYYY, HH24:MI');
  END IF;
  IF s.ends_at IS NOT NULL AND now() > s.ends_at THEN
    RAISE EXCEPTION 'This exam has closed.';
  END IF;

  SELECT * INTO c FROM exam_candidates
   WHERE session_id = s.id AND upper(access_code) = upper(trim(p_access_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Those details did not match. Check your access code and password.';
  END IF;

  IF c.password_hash <> crypt(p_password, c.password_hash) THEN
    INSERT INTO exam_events(candidate_id, type, meta)
      VALUES (c.id, 'failed_login', jsonb_build_object('fingerprint', p_fingerprint));
    RAISE EXCEPTION 'Those details did not match. Check your access code and password.';
  END IF;

  IF c.status = 'submitted' THEN
    RAISE EXCEPTION 'You have already submitted this exam.';
  END IF;

  -- Device lock: once an attempt is under way it stays on the machine it started on
  IF s.lock_to_device
     AND c.device_fingerprint IS NOT NULL
     AND p_fingerprint IS NOT NULL
     AND c.device_fingerprint <> p_fingerprint THEN
    INSERT INTO exam_events(candidate_id, type, meta)
      VALUES (c.id, 'device_mismatch', jsonb_build_object('expected', c.device_fingerprint, 'got', p_fingerprint));
    RAISE EXCEPTION 'This exam was started on another device. Ask your invigilator to release it.';
  END IF;

  SELECT jsonb_array_length(COALESCE(e.questions, '[]'::jsonb)) INTO n_questions
    FROM exams e WHERE e.id = s.exam_id;

  new_token := gen_random_uuid();

  UPDATE exam_candidates SET
    token              = new_token,
    token_issued_at    = now(),
    device_fingerprint = COALESCE(c.device_fingerprint, p_fingerprint),
    status             = CASE WHEN c.status = 'pending' THEN 'in_progress' ELSE c.status END,
    started_at         = COALESCE(c.started_at, now()),
    expires_at         = COALESCE(c.expires_at, now() + make_interval(mins => s.duration_minutes)),
    total_questions    = COALESCE(c.total_questions, n_questions),
    last_seen_at       = now(),
    question_order     = COALESCE(
                           c.question_order,
                           CASE WHEN s.shuffle_questions
                                THEN (SELECT array_agg(i ORDER BY random()) FROM generate_series(0, n_questions - 1) i)
                                ELSE (SELECT array_agg(i ORDER BY i)        FROM generate_series(0, n_questions - 1) i)
                           END
                         )
  WHERE id = c.id;

  INSERT INTO exam_events(candidate_id, type, meta)
    VALUES (c.id, 'login', jsonb_build_object('fingerprint', p_fingerprint));

  RETURN jsonb_build_object('token', new_token, 'candidateName', c.full_name, 'examTitle', s.title);
END;
$$;

-- ── 2. Deliver the paper, answer key stripped ──────────────────────────────

CREATE OR REPLACE FUNCTION exam_get_paper(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c    exam_candidates;
  s    exam_sessions;
  ex   record;
  out_questions jsonb := '[]'::jsonb;
  q    jsonb;
  i    integer;
BEGIN
  c := _exam_resolve(p_token);
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  SELECT questions, instructions INTO ex FROM exams WHERE id = s.exam_id;

  IF c.status = 'submitted' THEN
    RAISE EXCEPTION 'You have already submitted this exam.';
  END IF;

  -- Build the paper in the candidate's stored order, keeping only the fields a
  -- student needs to answer. correctAnswer and explanation are deliberately
  -- omitted and never reach the browser.
  -- COALESCE guards the case where the exam had no questions at login time,
  -- which leaves question_order NULL and would otherwise raise here.
  FOREACH i IN ARRAY COALESCE(c.question_order, ARRAY[]::integer[]) LOOP
    q := ex.questions -> i;
    IF q IS NOT NULL THEN
      out_questions := out_questions || jsonb_build_array(jsonb_build_object(
        'idx',      i,
        'question', q ->> 'question',
        'image',    q ->> 'image',
        'answers',  COALESCE(q -> 'answers', '[]'::jsonb)
      ));
    END IF;
  END LOOP;

  UPDATE exam_candidates SET last_seen_at = now() WHERE id = c.id;

  RETURN jsonb_build_object(
    'examTitle',      s.title,
    'candidateName',  c.full_name,
    'instructions',   COALESCE(to_jsonb(ex.instructions), '[]'::jsonb),
    'questions',      out_questions,
    'savedAnswers',   c.answers,
    'expiresAt',      c.expires_at,
    'serverNow',      now(),
    'maxTabSwitches', s.max_tab_switches,
    'tabSwitches',    c.tab_switches
  );
END;
$$;

-- ── 3. Autosave ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION exam_save_progress(p_token uuid, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE c exam_candidates;
BEGIN
  c := _exam_resolve(p_token);
  IF c.status = 'submitted' THEN
    RETURN jsonb_build_object('saved', false, 'reason', 'submitted');
  END IF;

  UPDATE exam_candidates
     SET answers = COALESCE(p_answers, '{}'::jsonb), last_seen_at = now()
   WHERE id = c.id;

  RETURN jsonb_build_object('saved', true);
END;
$$;

-- ── 4. Heartbeat: the timer lives on the server ────────────────────────────
-- A candidate cannot buy time by refreshing, changing the clock, or editing
-- the countdown in devtools. expires_at is set once at first login.

CREATE OR REPLACE FUNCTION exam_heartbeat(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c         exam_candidates;
  remaining integer;
BEGIN
  c := _exam_resolve(p_token);
  UPDATE exam_candidates SET last_seen_at = now() WHERE id = c.id;

  -- A candidate with no expires_at has not started, so report the full clock
  -- rather than NULL, which would read as "expired" on the client.
  IF c.expires_at IS NULL THEN
    RETURN jsonb_build_object('remainingSeconds', NULL, 'status', c.status, 'expired', false);
  END IF;

  remaining := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (c.expires_at - now())))::integer);

  RETURN jsonb_build_object(
    'remainingSeconds', remaining,
    'status',           c.status,
    'expired',          remaining <= 0
  );
END;
$$;

-- ── 5. Monitoring events ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION exam_log_event(p_token uuid, p_type text, p_meta jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c        exam_candidates;
  s        exam_sessions;
  switches integer;
BEGIN
  c := _exam_resolve(p_token);
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;

  INSERT INTO exam_events(candidate_id, type, meta) VALUES (c.id, p_type, COALESCE(p_meta, '{}'::jsonb));

  IF p_type = 'tab_blur' THEN
    UPDATE exam_candidates
       SET tab_switches = tab_switches + 1, last_seen_at = now()
     WHERE id = c.id
     RETURNING tab_switches INTO switches;

    IF s.max_tab_switches > 0 AND switches > s.max_tab_switches THEN
      UPDATE exam_candidates SET status = 'disqualified' WHERE id = c.id;
      INSERT INTO exam_events(candidate_id, type, meta)
        VALUES (c.id, 'auto_disqualified', jsonb_build_object('tabSwitches', switches));
      RETURN jsonb_build_object('tabSwitches', switches, 'disqualified', true);
    END IF;

    RETURN jsonb_build_object('tabSwitches', switches, 'disqualified', false,
                              'remaining', s.max_tab_switches - switches);
  END IF;

  UPDATE exam_candidates SET last_seen_at = now() WHERE id = c.id;
  RETURN jsonb_build_object('logged', true);
END;
$$;

-- ── 6. Submit and score, entirely server side ──────────────────────────────

CREATE OR REPLACE FUNCTION exam_submit(p_token uuid, p_answers jsonb, p_auto boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c        exam_candidates;
  s        exam_sessions;
  qs       jsonb;
  final    jsonb;
  k        text;
  given    text;
  correct  text;
  hits     integer := 0;
  total    integer;
BEGIN
  c := _exam_resolve(p_token);
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;

  IF c.status = 'submitted' THEN
    RETURN jsonb_build_object('alreadySubmitted', true);
  END IF;

  SELECT questions INTO qs FROM exams WHERE id = s.exam_id;
  final := COALESCE(p_answers, c.answers, '{}'::jsonb);
  total := jsonb_array_length(COALESCE(qs, '[]'::jsonb));

  FOR k IN SELECT jsonb_object_keys(final) LOOP
    given   := final ->> k;
    correct := (qs -> (k::integer)) ->> 'correctAnswer';
    IF given IS NOT NULL AND correct IS NOT NULL AND given = correct THEN
      hits := hits + 1;
    END IF;
  END LOOP;

  UPDATE exam_candidates SET
    answers         = final,
    score           = hits,
    total_questions = total,
    status          = 'submitted',
    submitted_at    = now(),
    last_seen_at    = now(),
    token           = NULL          -- the token dies with the submission
  WHERE id = c.id;

  INSERT INTO exam_events(candidate_id, type, meta)
    VALUES (c.id, CASE WHEN p_auto THEN 'auto_submit' ELSE 'submit' END,
            jsonb_build_object('score', hits, 'total', total));

  IF s.show_results_to_candidate THEN
    RETURN jsonb_build_object('submitted', true, 'score', hits, 'total', total, 'showResults', true);
  END IF;

  RETURN jsonb_build_object('submitted', true, 'showResults', false);
END;
$$;

-- ── Grants: these functions are the entire candidate-facing surface ─────────

GRANT EXECUTE ON FUNCTION exam_candidate_login(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_get_paper(uuid)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_save_progress(uuid, jsonb)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_heartbeat(uuid)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_log_event(uuid, text, jsonb)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_submit(uuid, jsonb, boolean)            TO anon, authenticated;

-- _exam_resolve is internal only. Postgres grants EXECUTE to PUBLIC by default,
-- so revoking from PUBLIC is what actually closes it, not revoking from anon.
REVOKE EXECUTE ON FUNCTION _exam_resolve(uuid) FROM PUBLIC, anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- ADMIN SIDE
--
-- Credential hashing happens here rather than in Node so the hash is produced
-- by the same pgcrypto implementation that exam_candidate_login verifies with.
-- These functions are revoked from PUBLIC and granted only to service_role,
-- which is the key the admin server holds and the browser never sees.
-- ═══════════════════════════════════════════════════════════════════════════

-- Ambiguous characters are left out so a candidate reading a printed slip does
-- not confuse O with 0 or I with 1.
CREATE OR REPLACE FUNCTION _exam_rand(n integer)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out text := '';
  i integer;
BEGIN
  FOR i IN 1..n LOOP
    out := out || substr(alphabet, floor(random() * length(alphabet))::integer + 1, 1);
  END LOOP;
  RETURN out;
END;
$$;

-- p_people: [{ "full_name": "...", "school": "...", "grade": "...", "user_id": null }, ...]
CREATE OR REPLACE FUNCTION admin_generate_candidates(p_session_id uuid, p_people jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  person    jsonb;
  code      text;
  pwd       text;
  attempts  integer;
  new_id    uuid;
  results   jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM exam_sessions WHERE id = p_session_id) THEN
    RAISE EXCEPTION 'That exam sitting no longer exists.';
  END IF;

  FOR person IN SELECT * FROM jsonb_array_elements(p_people) LOOP
    -- Retry on the small chance of a collision inside this sitting
    attempts := 0;
    LOOP
      code := _exam_rand(6);
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM exam_candidates WHERE session_id = p_session_id AND access_code = code
      );
      attempts := attempts + 1;
      IF attempts > 20 THEN
        RAISE EXCEPTION 'Could not allocate a unique access code. Try again.';
      END IF;
    END LOOP;

    pwd := _exam_rand(6);

    INSERT INTO exam_candidates (
      session_id, user_id, full_name, school, grade,
      access_code, password_hash, password_plain
    ) VALUES (
      p_session_id,
      NULLIF(person ->> 'user_id', '')::uuid,
      COALESCE(NULLIF(trim(person ->> 'full_name'), ''), 'Unnamed candidate'),
      NULLIF(person ->> 'school', ''),
      NULLIF(person ->> 'grade', ''),
      code,
      crypt(pwd, gen_salt('bf')),
      pwd
    )
    RETURNING id INTO new_id;

    results := results || jsonb_build_array(jsonb_build_object(
      'id',        new_id,
      'fullName',  COALESCE(NULLIF(trim(person ->> 'full_name'), ''), 'Unnamed candidate'),
      'school',    person ->> 'school',
      'grade',     person ->> 'grade',
      'accessCode', code,
      'password',  pwd
    ));
  END LOOP;

  RETURN jsonb_build_object('created', jsonb_array_length(results), 'candidates', results);
END;
$$;

-- Invigilator controls during a sitting.
--   release    a candidate who moved machines or whose browser crashed
--   extend     add minutes to one candidate's clock
--   reinstate  undo an automatic disqualification
--   disqualify stop an attempt by hand
--   reset      wipe the attempt so they can start clean
CREATE OR REPLACE FUNCTION admin_candidate_action(
  p_candidate_id uuid,
  p_action       text,
  p_minutes      integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE c exam_candidates;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;

  IF p_action = 'release' THEN
    UPDATE exam_candidates SET device_fingerprint = NULL, token = NULL WHERE id = c.id;

  ELSIF p_action = 'extend' THEN
    UPDATE exam_candidates
       SET expires_at = COALESCE(expires_at, now()) + make_interval(mins => GREATEST(p_minutes, 0))
     WHERE id = c.id;

  ELSIF p_action = 'reinstate' THEN
    UPDATE exam_candidates
       SET status = CASE WHEN submitted_at IS NOT NULL THEN 'submitted' ELSE 'in_progress' END,
           tab_switches = 0
     WHERE id = c.id;

  ELSIF p_action = 'disqualify' THEN
    UPDATE exam_candidates SET status = 'disqualified', token = NULL WHERE id = c.id;

  ELSIF p_action = 'reset' THEN
    UPDATE exam_candidates SET
      status = 'pending', token = NULL, device_fingerprint = NULL,
      question_order = NULL, answers = '{}'::jsonb, started_at = NULL,
      expires_at = NULL, submitted_at = NULL, score = NULL, tab_switches = 0
    WHERE id = c.id;

  ELSE
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;

  INSERT INTO exam_events(candidate_id, type, meta)
    VALUES (c.id, 'admin_' || p_action, jsonb_build_object('minutes', p_minutes));

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION _exam_rand(integer)                             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_generate_candidates(uuid, jsonb)          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_candidate_action(uuid, text, integer)     FROM PUBLIC, anon, authenticated;

GRANT  EXECUTE ON FUNCTION _exam_rand(integer)                             TO service_role;
GRANT  EXECUTE ON FUNCTION admin_generate_candidates(uuid, jsonb)          TO service_role;
GRANT  EXECUTE ON FUNCTION admin_candidate_action(uuid, text, integer)     TO service_role;
