-- ═══════════════════════════════════════════════════════════════════════════
-- EXAM PAUSE — make it actually stop the exam
--
-- Run once. Replaces five functions. No schema change, nothing to undo, and
-- safe to run twice.
--
-- WHAT IS WRONG TODAY
--
-- Pausing a sitting does nothing. Tested against live data on 8 October 2026:
-- with a sitting paused, a candidate who had never started could log in, pull
-- all 25 questions, save answers and submit. A candidate already writing kept
-- a running clock and kept autosaving. The admin badge said Paused throughout.
--
-- exam_mode_v2.sql was written to make pause real and redefined five
-- functions to check paused_at. Those redefinitions are not what is deployed.
-- The live functions are the originals from exam_mode.sql, which predate
-- pause. Confirmed by return shape rather than by guessing: the live
-- exam_heartbeat returns {remainingSeconds, status, expired}, which is
-- exam_mode.sql's shape, while every v2 branch also returns 'paused'. The
-- live exam_get_paper returns exam_mode.sql's nine keys with no 'paused'.
--
-- The likely cause is exam_mode.sql being re-run after exam_mode_v2.sql,
-- which silently reverted all five. The one v2 piece still working is
-- admin_session_action, so the button, the badge, the audit entry and the
-- give-back-the-time on resume all behave, and nothing enforces any of it.
--
-- WHAT THIS DOES
--
-- Restores each function from its newest correct source, copied verbatim
-- rather than retyped:
--
--   exam_save_progress   exam_mode_v2.sql      refuses to save while paused
--   exam_heartbeat       exam_mode_v2.sql      freezes the clock, reports paused
--   exam_submit          exam_mode_v2.sql      refuses a manual submit while paused
--   exam_get_paper       certificates.sql      sends the paused flag the runner needs
--   exam_candidate_login exam_results_images.sql + a new pause gate
--
-- The runner's full screen "Your exam is paused" overlay is driven by the
-- paused flag from exam_get_paper and exam_heartbeat. It has never appeared
-- because the server stopped sending it; restoring those two brings it back
-- with no client change.
--
-- THE NEW PART
--
-- exam_candidate_login has never checked pause, in any version. Pause sets
-- status to 'paused', not 'closed', so the closed check never caught it. A
-- candidate starting mid-pause also got extra time: login sets expires_at to
-- now() plus the full duration, and on resume admin_session_action adds the
-- entire pause on top for every in_progress candidate. The gate added below
-- sits after the submitted branch, so published results stay reachable while
-- a sitting is paused.
--
-- ORDER MATTERS. Nothing in this file depends on anything else being run
-- first, but re-running exam_mode.sql after this will undo it again.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── exam_save_progress, from exam_mode_v2.sql ─────────────────────────────

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

-- ── exam_heartbeat, from exam_mode_v2.sql ─────────────────────────────────

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

-- ── exam_submit, from exam_mode_v2.sql ────────────────────────────────────

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

-- ── exam_get_paper, from certificates.sql ─────────────────────────────────

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
        'idx',        i,
        'question',   q ->> 'question',
        'image',      q ->> 'image',
        'imageTitle', q ->> 'imageTitle',
        'answers',    COALESCE(q -> 'answers', '[]'::jsonb)
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

-- ── exam_candidate_login, from exam_results_images.sql, plus the gate ─────

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
  cert        certificates;
  cert_json   jsonb := NULL;
  new_token   uuid;
  n_questions integer;
  qs          jsonb;
  breakdown   jsonb := '[]'::jsonb;
  i           integer;
  q           jsonb;
BEGIN
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

  IF c.status = 'submitted' THEN
    SELECT * INTO cert FROM certificates
     WHERE candidate_id = c.id AND session_id = s.id AND revoked_at IS NULL
     LIMIT 1;

    IF FOUND THEN
      cert_json := jsonb_build_object(
        'serial', cert.serial, 'downloadKey', cert.download_key, 'band', cert.band
      );
    END IF;

    -- Nothing to collect and nothing to see yet
    IF s.results_published_at IS NULL AND cert_json IS NULL THEN
      RETURN jsonb_build_object('error', 'You have already submitted this exam. Results are not out yet.');
    END IF;

    IF s.results_published_at IS NOT NULL AND s.results_show_breakdown THEN
      SELECT questions INTO qs FROM exams WHERE id = s.exam_id;
      FOREACH i IN ARRAY COALESCE(c.question_order, ARRAY[]::integer[]) LOOP
        q := qs -> i;
        IF q IS NOT NULL THEN
          breakdown := breakdown || jsonb_build_array(jsonb_build_object(
            'question',      q ->> 'question',
            -- The two lines this migration exists for. exam_get_paper already
            -- sends these when the paper is sat; without them here a diagram
            -- question reviews as an empty row once results are published.
            'image',         q ->> 'image',
            'imageTitle',    q ->> 'imageTitle',
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
      'resultsOut',    s.results_published_at IS NOT NULL,
      'score',         CASE WHEN s.results_published_at IS NOT NULL THEN c.score END,
      'total',         CASE WHEN s.results_published_at IS NOT NULL THEN c.total_questions END,
      'submittedAt',   c.submitted_at,
      'breakdown',     breakdown,
      'showBreakdown', s.results_published_at IS NOT NULL AND s.results_show_breakdown,
      'certificate',   cert_json
    );
  END IF;

  IF s.status = 'closed' THEN
    RETURN jsonb_build_object('error', 'This exam has closed.');
  END IF;

  -- Pause has never been checked here, in any version of this function. A
  -- candidate who had not yet started could log in mid-pause, collect the
  -- paper and sit it, and on resume also received the whole pause duration
  -- added to a clock that had begun late. The submitted branch above has
  -- already returned, so published results stay reachable while paused.
  IF s.paused_at IS NOT NULL THEN
    RETURN jsonb_build_object('error',
      'This exam is paused. Wait for your invigilator to resume it, then sign in again.');
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

-- ── Grants ─────────────────────────────────────────────────────────────────
-- CREATE OR REPLACE keeps existing grants, but these are stated so a fresh
-- database reaches the same place.

GRANT EXECUTE ON FUNCTION exam_candidate_login(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_get_paper(uuid)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_save_progress(uuid, jsonb)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_heartbeat(uuid)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_submit(uuid, jsonb, boolean)            TO anon, authenticated;

-- Verify, with a sitting paused:
--   exam_heartbeat      must return a 'paused' key set to true
--   exam_get_paper      must return a 'paused' key set to true
--   exam_save_progress  must return {"saved": false, "reason": "paused"}
--   exam_submit         must raise, unless p_auto is true
--   exam_candidate_login for a candidate who has not started must return the
--                       paused error, while a submitted candidate still gets
--                       their published results
