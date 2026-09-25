-- ═══════════════════════════════════════════════════════════════════════════
-- EXAM RESULTS — put the pictures back in the question breakdown
--
-- Run after certificates.sql. Idempotent, safe to run twice.
-- Replaces one function. No schema change, nothing to undo.
--
-- exam_get_paper already hands the candidate 'image' and 'imageTitle' for each
-- question, which is why sitting an exam with diagrams works. The breakdown
-- built by exam_candidate_login did not, so the moment results were published
-- the pictures disappeared.
--
-- 377 exam-mode questions carry a picture, and 44 of those have no text at
-- all: the diagram is the question. On the results screen those 44 rendered as
-- "Q12." followed by nothing, so a student could not tell what they got wrong.
--
-- This is the exam_candidate_login body from certificates.sql, copied verbatim
-- with two lines added. Keep it that way: if you change the function there,
-- re-copy it here rather than hand editing both.
-- ═══════════════════════════════════════════════════════════════════════════

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

GRANT EXECUTE ON FUNCTION exam_candidate_login(text, text, text, text) TO anon, authenticated;

-- Verify: a submitted candidate whose results are published with breakdown on
-- should now get image alongside question.
--   SELECT jsonb_pretty(exam_candidate_login('<CODE>','<ACCESS>','<PASS>',NULL));
