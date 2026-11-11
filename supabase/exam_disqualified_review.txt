-- Run LAST, after exam_timeout_results.sql. Run the whole file through COMMIT.
-- Disqualified attempts receive an admin-only review score, never a published result.
BEGIN;
ALTER TABLE exam_candidates
  ADD COLUMN IF NOT EXISTS review_scored_at timestamptz,
  ADD COLUMN IF NOT EXISTS pre_disqualification_included boolean;

CREATE OR REPLACE FUNCTION _exam_score_disqualified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE qs jsonb; i integer; hits integer := 0; total integer; given text;
BEGIN
  IF NEW.status = 'disqualified' THEN
    IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'disqualified' OR OLD.review_scored_at IS NULL THEN
      NEW.pre_disqualification_included := CASE WHEN TG_OP = 'INSERT' THEN NEW.include_in_results ELSE OLD.include_in_results END;
      -- Paper marks and completed scores already exist; retain them unchanged.
      -- An interrupted online attempt is graded from its last saved answers.
      IF NEW.entry_source = 'online' AND (NEW.submitted_at IS NULL OR NEW.score IS NULL OR NEW.total_questions IS NULL) THEN
        SELECT e.questions INTO qs FROM exams e JOIN exam_sessions s ON s.exam_id=e.id WHERE s.id=NEW.session_id;
        total := jsonb_array_length(COALESCE(qs,'[]'::jsonb));
        FOR i IN 0..total-1 LOOP
          given := NEW.answers->>i::text;
          IF given IS NOT NULL AND given = (qs->i->>'correctAnswer') THEN hits := hits + 1; END IF;
        END LOOP;
        NEW.score := hits; NEW.total_questions := total;
      END IF;
      NEW.review_scored_at := now();
    ELSIF NEW.answers IS DISTINCT FROM OLD.answers OR NEW.score IS DISTINCT FROM OLD.score
       OR NEW.total_questions IS DISTINCT FROM OLD.total_questions THEN
      RAISE EXCEPTION 'This disqualified attempt is frozen for review. Reinstate it through the invigilator controls before changing its work.';
    END IF;
    NEW.include_in_results := false;
    NEW.token := NULL;
    -- Deliberately leave status, submitted_at, answers and the expiry clock unchanged.
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'disqualified' THEN
    -- Explicit reinstatement/reset is separate from reviewing the score.
    IF NEW.status = 'pending' THEN
      NEW.include_in_results := true;
    ELSE
      NEW.include_in_results := COALESCE(OLD.pre_disqualification_included,true);
    END IF;
    IF NEW.status IN ('pending','in_progress') THEN NEW.score := NULL; END IF;
    NEW.review_scored_at := NULL;
    NEW.pre_disqualification_included := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION _exam_score_disqualified() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS exam_score_disqualified ON exam_candidates;
CREATE TRIGGER exam_score_disqualified BEFORE INSERT OR UPDATE ON exam_candidates
  FOR EACH ROW EXECUTE FUNCTION _exam_score_disqualified();

CREATE OR REPLACE FUNCTION _exam_audit_disqualified_score()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF NEW.status = 'disqualified' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'disqualified'
     OR OLD.review_scored_at IS DISTINCT FROM NEW.review_scored_at) THEN
    UPDATE certificates SET revoked_at=now(),revoked_by='system (disqualification)',
      revoke_reason='Attempt disqualified; score retained for administrator review only.'
      WHERE candidate_id=NEW.id AND revoked_at IS NULL;
    PERFORM _exam_audit(NEW.session_id,NEW.id,'system','candidate.disqualified_review_score',
      jsonb_build_object('score',NEW.score,'total',NEW.total_questions,'source',NEW.entry_source,
        'tabSwitches',NEW.tab_switches,'reviewOnly',true),NULL);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION _exam_audit_disqualified_score() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS exam_audit_disqualified_score ON exam_candidates;
CREATE TRIGGER exam_audit_disqualified_score AFTER INSERT OR UPDATE ON exam_candidates
  FOR EACH ROW EXECUTE FUNCTION _exam_audit_disqualified_score();

-- Existing stopped attempts are scored too. Re-running does not regrade them.
UPDATE exam_candidates SET status=status WHERE status='disqualified' AND review_scored_at IS NULL;


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
  SELECT * INTO s FROM exam_sessions WHERE id=c.session_id FOR UPDATE;
  SELECT * INTO c FROM exam_candidates WHERE id=c.id FOR UPDATE;
  IF c.status = 'disqualified' THEN RETURN jsonb_build_object('saved',false,'reason','disqualified'); END IF;
  IF _exam_finish(c.id) IS NOT NULL THEN
    RETURN jsonb_build_object('saved',false,'reason','submitted','submission',_exam_submission_result(c.id));
  END IF;
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
    IF k !~ '^(0|[1-9][0-9]{0,5})$' THEN CONTINUE; END IF;
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

  IF p_password IS NULL OR c.password_hash IS DISTINCT FROM crypt(p_password, c.password_hash) THEN
    INSERT INTO exam_events(candidate_id, type, meta)
      VALUES (c.id, 'failed_login', jsonb_build_object('fingerprint', p_fingerprint));
    RETURN jsonb_build_object('error', 'Those details did not match. Check your access code and password.');
  END IF;

  IF c.status = 'disqualified' THEN
    RETURN jsonb_build_object('error','This attempt was stopped. Contact your invigilator for a review.');
  END IF;
  PERFORM _exam_finish(c.id);
  SELECT * INTO c FROM exam_candidates WHERE id=c.id;

  IF c.status = 'submitted' THEN
    IF NOT c.include_in_results THEN
      RETURN jsonb_build_object('mode','results','candidateName',c.full_name,'examTitle',s.title,
        'resultsOut',false,'resultIncluded',false,'timedOut',c.timed_out,'entrySource',c.entry_source);
    END IF;
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

    IF s.results_published_at IS NOT NULL AND s.results_show_breakdown AND c.entry_source = 'online' THEN
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
      'entrySource', c.entry_source, 'resultIncluded', c.include_in_results, 'timedOut', c.timed_out,
      'showBreakdown', s.results_published_at IS NOT NULL AND s.results_show_breakdown AND c.entry_source = 'online',
      'certificate',   cert_json
    );
  END IF;

  IF s.paused_at IS NOT NULL THEN
    RETURN jsonb_build_object('error','The exam is paused. Wait for your invigilator to resume it.');
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

NOTIFY pgrst, 'reload schema';
COMMIT;
