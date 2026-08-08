-- ═══════════════════════════════════════════════════════════════════════════
-- EXAM MODE v2 — dispute resolution, tamper-evident audit, invigilator controls
--
-- RUN ORDER:  exam_mode.sql  →  exam_mode_v2.sql  →  certificates.sql
--
-- Always finish with certificates.sql. It redefines exam_candidate_login with
-- the certificate lookup, so replaying this file afterwards would silently
-- remove certificates from the student's results page.
--
-- This file is idempotent and safe over a live install.
--
-- What this adds
-- --------------
-- 1. Every answer change is timestamped by the server, so "I answered that"
--    can be settled with a record rather than an argument.
-- 2. Every admin action records WHO did it, WHY, and is chained by hash so a
--    deleted or edited entry is detectable. Admin access no longer means
--    silent authority over the record.
-- 3. A sitting can be paused, which freezes every candidate's clock and gives
--    the time back on resume.
-- 4. Results can be released after the fact, so you are not forced to decide
--    at setup time whether candidates see their scores.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Session and candidate columns ──────────────────────────────────────────

ALTER TABLE exam_sessions
  ADD COLUMN IF NOT EXISTS results_published_at   timestamptz,
  ADD COLUMN IF NOT EXISTS results_published_by   text,
  ADD COLUMN IF NOT EXISTS results_show_breakdown boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS paused_at              timestamptz;

-- ── Answer-level history ───────────────────────────────────────────────────
-- One row per actual change. The client cannot backdate these: created_at is
-- the database clock at the moment the change reached the server.

CREATE TABLE IF NOT EXISTS exam_answer_log (
  id              bigserial PRIMARY KEY,
  candidate_id    uuid        NOT NULL REFERENCES exam_candidates(id) ON DELETE CASCADE,
  question_idx    integer     NOT NULL,
  answer          text,
  previous_answer text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exam_answer_log_candidate_idx
  ON exam_answer_log(candidate_id, created_at);

-- ── Tamper-evident admin audit ─────────────────────────────────────────────
-- Each row carries the hash of the row before it. Editing or deleting any
-- entry breaks the chain from that point on, and admin_verify_audit_chain
-- reports exactly where. This does not prevent tampering, it makes tampering
-- visible, which is what a dispute actually needs.

CREATE TABLE IF NOT EXISTS exam_audit_log (
  id           bigserial PRIMARY KEY,
  session_id   uuid,
  candidate_id uuid,
  actor_email  text        NOT NULL DEFAULT 'unknown',
  action       text        NOT NULL,
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  reason       text,
  prev_hash    text,
  entry_hash   text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exam_audit_log_session_idx ON exam_audit_log(session_id, id);

ALTER TABLE exam_answer_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE exam_audit_log  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON exam_answer_log FROM anon, authenticated;
REVOKE ALL ON exam_audit_log  FROM anon, authenticated;

-- ── Audit writer ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _exam_audit(
  p_session_id   uuid,
  p_candidate_id uuid,
  p_actor        text,
  p_action       text,
  p_detail       jsonb DEFAULT '{}'::jsonb,
  p_reason       text  DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  last_hash text;
  stamp     timestamptz := clock_timestamp();
  payload   text;
BEGIN
  SELECT entry_hash INTO last_hash FROM exam_audit_log ORDER BY id DESC LIMIT 1;

  payload := COALESCE(last_hash, '') || '|' || COALESCE(p_actor, '') || '|' || p_action
             || '|' || COALESCE(p_detail::text, '') || '|' || COALESCE(p_reason, '')
             || '|' || stamp::text;

  INSERT INTO exam_audit_log (
    session_id, candidate_id, actor_email, action, detail, reason,
    prev_hash, entry_hash, created_at
  ) VALUES (
    p_session_id, p_candidate_id, COALESCE(NULLIF(trim(p_actor), ''), 'unknown'),
    p_action, COALESCE(p_detail, '{}'::jsonb), NULLIF(trim(p_reason), ''),
    last_hash, encode(digest(payload, 'sha256'), 'hex'), stamp
  );
END;
$$;

CREATE OR REPLACE FUNCTION admin_verify_audit_chain()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  r         record;
  expected  text;
  last_hash text := NULL;
  broken_at bigint := NULL;
  n         integer := 0;
BEGIN
  FOR r IN SELECT * FROM exam_audit_log ORDER BY id LOOP
    expected := encode(digest(
      COALESCE(last_hash, '') || '|' || COALESCE(r.actor_email, '') || '|' || r.action
      || '|' || COALESCE(r.detail::text, '') || '|' || COALESCE(r.reason, '')
      || '|' || r.created_at::text, 'sha256'), 'hex');

    IF expected <> r.entry_hash AND broken_at IS NULL THEN
      broken_at := r.id;
    END IF;

    last_hash := r.entry_hash;
    n := n + 1;
  END LOOP;

  RETURN jsonb_build_object('entries', n, 'intact', broken_at IS NULL, 'brokenAt', broken_at);
END;
$$;

-- ── Answer logging on save ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION exam_save_progress(p_token uuid, p_answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c       exam_candidates;
  s       exam_sessions;
  k       text;
  new_val text;
  old_val text;
  changes integer := 0;
BEGIN
  c := _exam_resolve(p_token);
  IF c.status = 'submitted' THEN
    RETURN jsonb_build_object('saved', false, 'reason', 'submitted');
  END IF;

  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  IF s.paused_at IS NOT NULL THEN
    RETURN jsonb_build_object('saved', false, 'reason', 'paused');
  END IF;

  -- Log only genuine changes, so the timeline reads as decisions the candidate
  -- made rather than autosave noise.
  FOR k IN SELECT jsonb_object_keys(COALESCE(p_answers, '{}'::jsonb)) LOOP
    new_val := p_answers ->> k;
    old_val := c.answers ->> k;
    IF new_val IS DISTINCT FROM old_val THEN
      INSERT INTO exam_answer_log (candidate_id, question_idx, answer, previous_answer)
      VALUES (c.id, k::integer, new_val, old_val);
      changes := changes + 1;
    END IF;
  END LOOP;

  UPDATE exam_candidates
     SET answers = COALESCE(p_answers, '{}'::jsonb), last_seen_at = now()
   WHERE id = c.id;

  RETURN jsonb_build_object('saved', true, 'changes', changes);
END;
$$;

-- ── Heartbeat, now pause aware ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION exam_heartbeat(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c         exam_candidates;
  s         exam_sessions;
  remaining integer;
BEGIN
  c := _exam_resolve(p_token);
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  UPDATE exam_candidates SET last_seen_at = now() WHERE id = c.id;

  IF c.expires_at IS NULL THEN
    RETURN jsonb_build_object('remainingSeconds', NULL, 'status', c.status,
                              'expired', false, 'paused', s.paused_at IS NOT NULL);
  END IF;

  -- While paused the clock is measured to the moment of pausing, so the
  -- countdown holds still instead of draining behind a frozen screen.
  IF s.paused_at IS NOT NULL THEN
    remaining := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (c.expires_at - s.paused_at)))::integer);
    RETURN jsonb_build_object('remainingSeconds', remaining, 'status', c.status,
                              'expired', false, 'paused', true);
  END IF;

  remaining := GREATEST(0, CEIL(EXTRACT(EPOCH FROM (c.expires_at - now())))::integer);
  RETURN jsonb_build_object('remainingSeconds', remaining, 'status', c.status,
                            'expired', remaining <= 0, 'paused', false);
END;
$$;

-- ── Paper delivery reports pause too ───────────────────────────────────────

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
    'paused',         s.paused_at IS NOT NULL,
    'maxTabSwitches', s.max_tab_switches,
    'tabSwitches',    c.tab_switches
  );
END;
$$;

-- ── Login: returns results once they are published ─────────────────────────

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
  s           exam_sessions;
  c           exam_candidates;
  new_token   uuid;
  n_questions integer;
  qs          jsonb;
  breakdown   jsonb := '[]'::jsonb;
  i           integer;
  q           jsonb;
BEGIN
  -- Failures return an error object rather than raising. RAISE would roll back
  -- the transaction, taking the exam_events row with it, so every failed login
  -- and device mismatch would vanish from the security log exactly when it
  -- matters most. The client turns a returned error into a thrown one.
  SELECT * INTO s FROM exam_sessions WHERE upper(session_code) = upper(trim(p_session_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'We could not find that exam. Check the link and try again.');
  END IF;

  SELECT * INTO c FROM exam_candidates
   WHERE session_id = s.id AND upper(access_code) = upper(trim(p_access_code));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Those details did not match. Check your access code and password.');
  END IF;

  IF c.password_hash <> crypt(p_password, c.password_hash) THEN
    INSERT INTO exam_events(candidate_id, type, meta)
      VALUES (c.id, 'failed_login', jsonb_build_object('fingerprint', p_fingerprint));
    RETURN jsonb_build_object('error', 'Those details did not match. Check your access code and password.');
  END IF;

  -- Already finished: hand back results if they have been released, otherwise
  -- say so plainly. Same link, same credentials, no second system to explain.
  IF c.status = 'submitted' THEN
    IF s.results_published_at IS NULL THEN
      RETURN jsonb_build_object('error', 'You have already submitted this exam. Results are not out yet.');
    END IF;

    IF s.results_show_breakdown THEN
      SELECT questions INTO qs FROM exams WHERE id = s.exam_id;
      FOREACH i IN ARRAY COALESCE(c.question_order, ARRAY[]::integer[]) LOOP
        q := qs -> i;
        IF q IS NOT NULL THEN
          breakdown := breakdown || jsonb_build_array(jsonb_build_object(
            'question',      q ->> 'question',
            'yourAnswer',    c.answers ->> i::text,
            'correctAnswer', q ->> 'correctAnswer',
            'explanation',   q ->> 'explanation',
            'correct',       (c.answers ->> i::text) IS NOT NULL
                             AND (c.answers ->> i::text) = (q ->> 'correctAnswer')
          ));
        END IF;
      END LOOP;
    END IF;

    INSERT INTO exam_events(candidate_id, type, meta)
      VALUES (c.id, 'viewed_results', '{}'::jsonb);

    RETURN jsonb_build_object(
      'mode', 'results', 'candidateName', c.full_name, 'examTitle', s.title,
      'score', c.score, 'total', c.total_questions,
      'submittedAt', c.submitted_at, 'breakdown', breakdown,
      'showBreakdown', s.results_show_breakdown
    );
  END IF;

  IF s.status = 'closed' THEN
    RETURN jsonb_build_object('error', 'This exam has closed.');
  END IF;
  IF s.starts_at IS NOT NULL AND now() < s.starts_at THEN
    RETURN jsonb_build_object('error',
      'This exam has not opened yet. It starts at ' || to_char(s.starts_at, 'DD Mon YYYY, HH24:MI') || '.');
  END IF;
  IF s.ends_at IS NOT NULL AND now() > s.ends_at THEN
    RETURN jsonb_build_object('error', 'This exam has closed.');
  END IF;

  IF s.lock_to_device
     AND c.device_fingerprint IS NOT NULL
     AND p_fingerprint IS NOT NULL
     AND c.device_fingerprint <> p_fingerprint THEN
    INSERT INTO exam_events(candidate_id, type, meta)
      VALUES (c.id, 'device_mismatch', jsonb_build_object('expected', c.device_fingerprint, 'got', p_fingerprint));
    RETURN jsonb_build_object('error',
      'This exam was started on another device. Ask your invigilator to release it.');
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
                                THEN (SELECT array_agg(i2 ORDER BY random()) FROM generate_series(0, n_questions - 1) i2)
                                ELSE (SELECT array_agg(i2 ORDER BY i2)        FROM generate_series(0, n_questions - 1) i2)
                           END
                         )
  WHERE id = c.id;

  INSERT INTO exam_events(candidate_id, type, meta)
    VALUES (c.id, 'login', jsonb_build_object('fingerprint', p_fingerprint));

  RETURN jsonb_build_object('mode', 'exam', 'token', new_token,
                            'candidateName', c.full_name, 'examTitle', s.title);
END;
$$;

-- ── Submit: pause aware, and logs the final answers ────────────────────────

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
  old_val  text;
  hits     integer := 0;
  total    integer;
BEGIN
  c := _exam_resolve(p_token);
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;

  IF c.status = 'submitted' THEN
    RETURN jsonb_build_object('alreadySubmitted', true);
  END IF;

  -- A paused sitting must not accept submissions, otherwise a candidate can
  -- bank an answer sheet during a stoppage nobody was supervising.
  IF s.paused_at IS NOT NULL AND NOT p_auto THEN
    RAISE EXCEPTION 'The exam is paused. Wait for your invigilator to resume it.';
  END IF;

  SELECT questions INTO qs FROM exams WHERE id = s.exam_id;
  final := COALESCE(p_answers, c.answers, '{}'::jsonb);
  total := jsonb_array_length(COALESCE(qs, '[]'::jsonb));

  FOR k IN SELECT jsonb_object_keys(final) LOOP
    given   := final ->> k;
    correct := (qs -> (k::integer)) ->> 'correctAnswer';
    old_val := c.answers ->> k;

    -- Anything changed in the final moments still gets a timestamp
    IF given IS DISTINCT FROM old_val THEN
      INSERT INTO exam_answer_log (candidate_id, question_idx, answer, previous_answer)
      VALUES (c.id, k::integer, given, old_val);
    END IF;

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
    token           = NULL
  WHERE id = c.id;

  INSERT INTO exam_events(candidate_id, type, meta)
    VALUES (c.id, CASE WHEN p_auto THEN 'auto_submit' ELSE 'submit' END,
            jsonb_build_object('score', hits, 'total', total,
                               'answered', (SELECT count(*) FROM jsonb_object_keys(final))));

  IF s.show_results_to_candidate OR s.results_published_at IS NOT NULL THEN
    RETURN jsonb_build_object('submitted', true, 'score', hits, 'total', total, 'showResults', true);
  END IF;

  RETURN jsonb_build_object('submitted', true, 'showResults', false);
END;
$$;

-- ── Candidate actions, now with actor and reason ───────────────────────────

CREATE OR REPLACE FUNCTION admin_candidate_action(
  p_candidate_id uuid,
  p_action       text,
  p_minutes      integer DEFAULT 0,
  p_actor        text    DEFAULT 'unknown',
  p_reason       text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c      exam_candidates;
  before jsonb;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;

  -- Capture the prior state so a dispute can see what actually changed
  before := jsonb_build_object(
    'status', c.status, 'expiresAt', c.expires_at,
    'tabSwitches', c.tab_switches, 'score', c.score
  );

  IF p_action = 'release' THEN
    UPDATE exam_candidates SET device_fingerprint = NULL, token = NULL WHERE id = c.id;

  ELSIF p_action = 'extend' THEN
    UPDATE exam_candidates
       SET expires_at = COALESCE(expires_at, now()) + make_interval(mins => GREATEST(p_minutes, 0))
     WHERE id = c.id;

  ELSIF p_action = 'reduce' THEN
    UPDATE exam_candidates
       SET expires_at = GREATEST(now(), COALESCE(expires_at, now()) - make_interval(mins => GREATEST(p_minutes, 0)))
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
    VALUES (c.id, 'admin_' || p_action,
            jsonb_build_object('minutes', p_minutes, 'actor', p_actor, 'reason', p_reason));

  PERFORM _exam_audit(
    c.session_id, c.id, p_actor, 'candidate.' || p_action,
    jsonb_build_object('candidate', c.full_name, 'minutes', p_minutes, 'before', before),
    p_reason
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── Session-wide invigilator controls ──────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_session_action(
  p_session_id uuid,
  p_action     text,
  p_value      integer DEFAULT 0,
  p_flag       boolean DEFAULT NULL,
  p_actor      text    DEFAULT 'unknown',
  p_reason     text    DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  s        exam_sessions;
  paused_s integer;
  affected integer := 0;
  cleared  boolean := false;
BEGIN
  SELECT * INTO s FROM exam_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'That exam sitting no longer exists.'; END IF;

  IF p_action = 'pause' THEN
    IF s.paused_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', true, 'alreadyPaused', true);
    END IF;
    UPDATE exam_sessions SET paused_at = now(), status = 'paused' WHERE id = s.id;

  ELSIF p_action = 'resume' THEN
    IF s.paused_at IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'notPaused', true);
    END IF;
    -- Give back exactly the time that was lost, per candidate still writing
    paused_s := CEIL(EXTRACT(EPOCH FROM (now() - s.paused_at)))::integer;
    UPDATE exam_candidates
       SET expires_at = expires_at + make_interval(secs => paused_s)
     WHERE session_id = s.id AND status = 'in_progress' AND expires_at IS NOT NULL;
    GET DIAGNOSTICS affected = ROW_COUNT;
    UPDATE exam_sessions SET paused_at = NULL, status = 'live' WHERE id = s.id;

  ELSIF p_action = 'extend_all' THEN
    UPDATE exam_candidates
       SET expires_at = COALESCE(expires_at, now()) + make_interval(mins => GREATEST(p_value, 0))
     WHERE session_id = s.id AND status = 'in_progress';
    GET DIAGNOSTICS affected = ROW_COUNT;

  ELSIF p_action = 'publish_results' THEN
    UPDATE exam_sessions
       SET results_published_at = now(), results_published_by = p_actor
     WHERE id = s.id;

  ELSIF p_action = 'unpublish_results' THEN
    UPDATE exam_sessions
       SET results_published_at = NULL, results_published_by = NULL
     WHERE id = s.id;

  ELSIF p_action = 'set_show_results' THEN
    UPDATE exam_sessions SET show_results_to_candidate = COALESCE(p_flag, false) WHERE id = s.id;

  ELSIF p_action = 'set_breakdown' THEN
    UPDATE exam_sessions SET results_show_breakdown = COALESCE(p_flag, false) WHERE id = s.id;

  ELSIF p_action = 'set_tab_limit' THEN
    UPDATE exam_sessions SET max_tab_switches = GREATEST(p_value, 0) WHERE id = s.id;

  ELSIF p_action = 'set_device_lock' THEN
    UPDATE exam_sessions SET lock_to_device = COALESCE(p_flag, false) WHERE id = s.id;

  ELSIF p_action = 'close' THEN
    UPDATE exam_sessions SET status = 'closed', paused_at = NULL WHERE id = s.id;

  ELSIF p_action = 'open' THEN
    -- Opening is an explicit instruction to let candidates in now. A closing
    -- time already in the past, or an opening time still in the future,
    -- contradicts that instruction: login checks the window separately from
    -- the status, so the sitting would read "live" and still turn everyone
    -- away at the door.
    --
    -- Clear whichever boundary contradicts being open, and report it back so
    -- the change is visible rather than silent.
    cleared := (s.ends_at   IS NOT NULL AND s.ends_at   <= now())
            OR (s.starts_at IS NOT NULL AND s.starts_at >  now());

    UPDATE exam_sessions SET
      status    = 'live',
      paused_at = NULL,
      starts_at = CASE WHEN starts_at IS NOT NULL AND starts_at > now()  THEN NULL ELSE starts_at END,
      ends_at   = CASE WHEN ends_at   IS NOT NULL AND ends_at  <= now()  THEN NULL ELSE ends_at   END
    WHERE id = s.id;

  ELSE
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;

  PERFORM _exam_audit(
    s.id, NULL, p_actor, 'session.' || p_action,
    jsonb_build_object('value', p_value, 'flag', p_flag, 'affected', affected,
                       'sitting', s.title, 'clearedWindow', cleared),
    p_reason
  );

  RETURN jsonb_build_object('ok', true, 'affected', affected, 'clearedWindow', cleared);
END;
$$;

-- ── Submission transcript ──────────────────────────────────────────────────
-- Everything needed to reconcile a challenge: what they were shown, what they
-- chose, when they chose it, what they changed their mind about, and every
-- monitoring event, in order.

CREATE OR REPLACE FUNCTION admin_get_transcript(p_candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c       exam_candidates;
  s       exam_sessions;
  qs      jsonb;
  rows_   jsonb := '[]'::jsonb;
  q       jsonb;
  i       integer;
  given   text;
  correct text;
  changed jsonb;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  SELECT questions INTO qs FROM exams WHERE id = s.exam_id;

  FOREACH i IN ARRAY COALESCE(c.question_order, ARRAY[]::integer[]) LOOP
    q := qs -> i;
    CONTINUE WHEN q IS NULL;

    given   := c.answers ->> i::text;
    correct := q ->> 'correctAnswer';

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'at', l.created_at, 'from', l.previous_answer, 'to', l.answer
           ) ORDER BY l.created_at), '[]'::jsonb)
      INTO changed
      FROM exam_answer_log l
     WHERE l.candidate_id = c.id AND l.question_idx = i;

    rows_ := rows_ || jsonb_build_array(jsonb_build_object(
      'idx',           i,
      'question',      q ->> 'question',
      'options',       COALESCE(q -> 'answers', '[]'::jsonb),
      'yourAnswer',    given,
      'correctAnswer', correct,
      'correct',       given IS NOT NULL AND given = correct,
      'history',       changed
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'candidate', jsonb_build_object(
      'id', c.id, 'name', c.full_name, 'school', c.school, 'grade', c.grade,
      'accessCode', c.access_code, 'status', c.status,
      'startedAt', c.started_at, 'submittedAt', c.submitted_at,
      'expiresAt', c.expires_at, 'score', c.score, 'total', c.total_questions,
      'tabSwitches', c.tab_switches
    ),
    'sitting', jsonb_build_object('id', s.id, 'title', s.title, 'code', s.session_code),
    'questions', rows_,
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('at', e.created_at, 'type', e.type, 'meta', e.meta)
             ORDER BY e.created_at)
        FROM exam_events e WHERE e.candidate_id = c.id
    ), '[]'::jsonb),
    'adminActions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'at', a.created_at, 'actor', a.actor_email,
               'action', a.action, 'reason', a.reason, 'detail', a.detail
             ) ORDER BY a.created_at)
        FROM exam_audit_log a WHERE a.candidate_id = c.id
    ), '[]'::jsonb)
  );
END;
$$;

-- ── Grants ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION exam_save_progress(uuid, jsonb)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_heartbeat(uuid)                                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_get_paper(uuid)                                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_candidate_login(text, text, text, text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_submit(uuid, jsonb, boolean)                   TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION _exam_audit(uuid, uuid, text, text, jsonb, text)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_verify_audit_chain()                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_session_action(uuid, text, integer, boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_get_transcript(uuid)                         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_candidate_action(uuid, text, integer, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION _exam_audit(uuid, uuid, text, text, jsonb, text)    TO service_role;
GRANT EXECUTE ON FUNCTION admin_verify_audit_chain()                          TO service_role;
GRANT EXECUTE ON FUNCTION admin_session_action(uuid, text, integer, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION admin_get_transcript(uuid)                          TO service_role;
GRANT EXECUTE ON FUNCTION admin_candidate_action(uuid, text, integer, text, text) TO service_role;

-- The 3-argument form from v1 is replaced by the 5-argument form above.
DROP FUNCTION IF EXISTS admin_candidate_action(uuid, text, integer);
