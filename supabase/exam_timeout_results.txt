-- Run LAST, after exam_paper_results.sql and exam_account_claims.sql.
-- Run the entire file, including COMMIT. Safe to rerun.
BEGIN;
ALTER TABLE exam_candidates
  ADD COLUMN IF NOT EXISTS timed_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS include_in_results boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS result_decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS result_decided_by text,
  ADD COLUMN IF NOT EXISTS result_decision_reason text;
CREATE INDEX IF NOT EXISTS exam_candidates_expiry_idx ON exam_candidates(expires_at)
  WHERE status = 'in_progress' AND entry_source = 'online';

-- Recognize historical browser auto-submissions without changing their grades.
UPDATE exam_candidates c SET timed_out = true
 WHERE NOT timed_out AND status = 'submitted' AND entry_source = 'online'
 AND EXISTS (SELECT 1 FROM exam_events e WHERE e.candidate_id = c.id AND e.type = 'auto_submit'
   AND e.created_at >= c.submitted_at);

CREATE OR REPLACE FUNCTION _exam_submission_result(p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions; visible boolean;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  visible := c.include_in_results AND c.status = 'submitted'
    AND (s.show_results_to_candidate OR s.results_published_at IS NOT NULL);
  RETURN jsonb_build_object('submitted', c.status = 'submitted', 'timedOut', c.timed_out,
    'resultIncluded', c.include_in_results, 'showResults', visible,
    'score', CASE WHEN visible THEN c.score END, 'total', CASE WHEN visible THEN c.total_questions END);
END $$;
REVOKE ALL ON FUNCTION _exam_submission_result(uuid) FROM PUBLIC, anon, authenticated;

-- Call with expiry-only=true from sweeps/read paths; never completes a live attempt early.
-- A late request cannot replace saved answers, even if it claims to be an auto-submit.
CREATE OR REPLACE FUNCTION _exam_finish(p_candidate_id uuid, p_answers jsonb DEFAULT NULL, p_expiry_only boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions; due boolean; qs jsonb; final jsonb := '{}';
  i integer; given text; hits integer := 0; total integer; answered integer := 0;
BEGIN
  SELECT session_id INTO c.session_id FROM exam_candidates WHERE id = p_candidate_id;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id FOR UPDATE;
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  IF c.status = 'submitted' THEN RETURN _exam_submission_result(c.id); END IF;
  IF c.status <> 'in_progress' OR c.entry_source <> 'online' THEN RETURN NULL; END IF;
  due := c.expires_at IS NOT NULL AND c.expires_at <= COALESCE(s.paused_at, now());
  IF p_expiry_only AND NOT due THEN RETURN NULL; END IF;
  IF s.paused_at IS NOT NULL AND NOT due THEN RAISE EXCEPTION 'The exam is paused. Wait for your invigilator to resume it.'; END IF;
  SELECT questions INTO qs FROM exams WHERE id = s.exam_id;
  total := jsonb_array_length(COALESCE(qs, '[]'));
  -- Score each real question once. Invalid indexes and unanswered questions earn zero.
  FOR i IN 0..total-1 LOOP
    given := (CASE WHEN due THEN c.answers ELSE COALESCE(p_answers, c.answers) END)->>i::text;
    IF given IS NOT NULL THEN
      final := final || jsonb_build_object(i::text, given); answered := answered + 1;
      IF given = (qs->i->>'correctAnswer') THEN hits := hits + 1; END IF;
    END IF;
    IF given IS DISTINCT FROM (c.answers->>i::text) THEN
      INSERT INTO exam_answer_log(candidate_id, question_idx, answer, previous_answer)
        VALUES(c.id, i, given, c.answers->>i::text);
    END IF;
  END LOOP;
  UPDATE exam_candidates SET answers = final, score = hits, total_questions = total,
    status = 'submitted', submitted_at = CASE WHEN due THEN c.expires_at ELSE now() END,
    timed_out = due WHERE id = c.id;
  -- Keep the token read-only after submission so retries/heartbeats can acknowledge completion.
  INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id, CASE WHEN due THEN 'auto_submit' ELSE 'submit' END,
    jsonb_build_object('score',hits,'total',total,'answered',answered,'timedOut',due,'savedAnswersOnly',due));
  IF due THEN
    PERFORM _exam_audit(c.session_id,c.id,'system','candidate.timeout',
      jsonb_build_object('score',hits,'total',total,'answered',answered,'expiresAt',c.expires_at),NULL);
    IF s.results_published_at IS NOT NULL AND s.certificate_mode = 'on_publish' THEN
      BEGIN
        PERFORM _cert_issue(c.id, 'system (timeout after publication)');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id,'certificate_failed',jsonb_build_object('error',SQLERRM));
      END;
    END IF;
  END IF;
  RETURN _exam_submission_result(c.id);
END $$;
REVOKE ALL ON FUNCTION _exam_finish(uuid,jsonb,boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION admin_finalize_expired_exams(p_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE target uuid; n integer := 0; result jsonb;
BEGIN
  FOR target IN SELECT c.id FROM exam_candidates c JOIN exam_sessions s ON s.id = c.session_id
    WHERE c.status = 'in_progress' AND c.entry_source = 'online'
      AND (p_session_id IS NULL OR c.session_id = p_session_id)
      AND c.expires_at <= COALESCE(s.paused_at, now()) ORDER BY c.session_id,c.id
  LOOP
    result := _exam_finish(target);
    IF result IS NOT NULL THEN n := n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('finalized',n);
END $$;
REVOKE ALL ON FUNCTION admin_finalize_expired_exams(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_finalize_expired_exams(uuid) TO service_role;

CREATE OR REPLACE FUNCTION exam_submit(p_token uuid, p_answers jsonb, p_auto boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates;
BEGIN
  c := _exam_resolve(p_token);
  RETURN _exam_finish(c.id, p_answers, false);
END $$;
GRANT EXECUTE ON FUNCTION exam_submit(uuid,jsonb,boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION admin_set_timeout_result(p_candidate_id uuid,p_include boolean,p_actor text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions;
BEGIN
  IF p_include IS NULL OR length(trim(COALESCE(p_reason,''))) < 3 THEN RAISE EXCEPTION 'Choose inclusion and give a reason.'; END IF;
  SELECT session_id INTO c.session_id FROM exam_candidates WHERE id=p_candidate_id;
  SELECT * INTO s FROM exam_sessions WHERE id=c.session_id FOR UPDATE;
  PERFORM _exam_finish(p_candidate_id);
  SELECT * INTO c FROM exam_candidates WHERE id=p_candidate_id FOR UPDATE;
  IF NOT c.timed_out OR c.status <> 'submitted' THEN RAISE EXCEPTION 'Only completed timed-out attempts use this control.'; END IF;
  IF c.include_in_results = p_include THEN RETURN jsonb_build_object('changed',false); END IF;
  UPDATE exam_candidates SET include_in_results=p_include, result_decided_at=now(),
    result_decided_by=p_actor, result_decision_reason=trim(p_reason) WHERE id=c.id;
  IF NOT p_include THEN
    UPDATE certificates SET revoked_at=now(), revoked_by=p_actor,
      revoke_reason='Excluded timed-out result: ' || trim(p_reason)
      WHERE candidate_id=c.id AND revoked_at IS NULL;
  ELSIF s.certificate_mode='on_submit' OR (s.certificate_mode='on_publish' AND s.results_published_at IS NOT NULL) THEN
    PERFORM _cert_issue(c.id,p_actor);
  END IF;
  PERFORM _exam_audit(c.session_id,c.id,p_actor,'candidate.result_inclusion',
    jsonb_build_object('included',p_include,'score',c.score,'total',c.total_questions),p_reason);
  RETURN jsonb_build_object('changed',true,'included',p_include);
END $$;
REVOKE ALL ON FUNCTION admin_set_timeout_result(uuid,boolean,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION admin_set_timeout_result(uuid,boolean,text,text) TO service_role;


CREATE OR REPLACE FUNCTION _cert_issue(p_candidate_id uuid, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c        exam_candidates;
  s        exam_sessions;
  pct      numeric;
  chosen   jsonb;
  tpl      certificate_templates;
  new_ser  text;
  new_id   uuid;
  new_key  uuid;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Candidate not found');
  END IF;

  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;

  IF NOT c.include_in_results THEN
    RETURN jsonb_build_object('issued',false,'reason','Excluded from results');
  END IF;

  -- Hard eligibility. These are not configurable on purpose: a stopped
  -- candidate must never be issuable, including through a bulk action taken
  -- by someone not watching the screen.
  IF c.status = 'disqualified' THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Attempt was stopped');
  END IF;
  IF c.status <> 'submitted' OR c.submitted_at IS NULL THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Has not submitted');
  END IF;

  IF EXISTS (
    SELECT 1 FROM certificates
     WHERE candidate_id = c.id AND session_id = s.id AND revoked_at IS NULL
  ) THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Already has a certificate');
  END IF;

  pct := CASE WHEN COALESCE(c.total_questions, 0) > 0
              THEN round((COALESCE(c.score, 0)::numeric / c.total_questions) * 100)
              ELSE 0 END;

  -- Highest band the candidate clears
  SELECT b INTO chosen
    FROM jsonb_array_elements(COALESCE(s.certificate_bands, '[]'::jsonb)) b
   WHERE COALESCE((b ->> 'minPercent')::numeric, 0) <= pct
   ORDER BY COALESCE((b ->> 'minPercent')::numeric, 0) DESC
   LIMIT 1;

  IF chosen IS NULL THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Score is below every band');
  END IF;

  -- NULLIF before the cast. A band saved without a design holds an empty
  -- string, and ''::uuid raises rather than returning a row, which turned a
  -- half-finished setting into a hard error instead of a clear skip reason.
  IF NULLIF(trim(COALESCE(chosen ->> 'templateId', '')), '') IS NULL THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'That band has no design attached');
  END IF;

  SELECT * INTO tpl FROM certificate_templates
   WHERE id = NULLIF(trim(chosen ->> 'templateId'), '')::uuid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'The design for that band no longer exists');
  END IF;

  new_ser := _cert_next_serial(s.id);
  new_key := gen_random_uuid();

  INSERT INTO certificates (
    serial, download_key, session_id, candidate_id, template_id, band, snapshot, issued_by
  ) VALUES (
    new_ser, new_key, s.id, c.id, tpl.id, chosen ->> 'band',
    jsonb_build_object(
      'candidate_name', c.full_name,
      'school',         COALESCE(c.school, ''),
      'grade',          COALESCE(c.grade, ''),
      'exam_title',     s.title,
      'score',          COALESCE(c.score, 0),
      'total',          COALESCE(c.total_questions, 0),
      'percentage',     pct,
      'grade_band',     chosen ->> 'band',
      'date_issued',    to_char(now(), 'DD Mon YYYY'),
      'serial',         new_ser
    ),
    p_actor
  )
  RETURNING id INTO new_id;

  RETURN jsonb_build_object(
    'issued', true, 'id', new_id, 'serial', new_ser,
    'downloadKey', new_key, 'band', chosen ->> 'band'
  );
END;
$$;

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
  IF _exam_finish(c.id) IS NOT NULL THEN
    RETURN jsonb_build_object('remainingSeconds',0,'status','submitted','expired',true,'paused',false,
      'submission',_exam_submission_result(c.id));
  END IF;
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
  IF _exam_finish(c.id) IS NOT NULL THEN
    RETURN jsonb_build_object('completed',true,'submission',_exam_submission_result(c.id));
  END IF;
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

CREATE OR REPLACE FUNCTION _exam_account_result(p_candidate_id uuid, p_breakdown boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  c exam_candidates; s exam_sessions; cert certificates;
  released boolean; certificate_json jsonb := NULL; breakdown jsonb := '[]';
  qs jsonb; q jsonb; i integer;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM _exam_finish(c.id);
  SELECT * INTO c FROM exam_candidates WHERE id=p_candidate_id;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  released := s.results_published_at IS NOT NULL AND c.status = 'submitted' AND c.include_in_results;
  IF c.status = 'submitted' AND c.include_in_results THEN
    SELECT * INTO cert FROM certificates WHERE candidate_id = c.id AND session_id = s.id
      AND revoked_at IS NULL LIMIT 1;
    IF FOUND THEN
      certificate_json := jsonb_build_object('serial', cert.serial, 'downloadKey', cert.download_key, 'band', cert.band);
    END IF;
  END IF;
  IF p_breakdown AND released AND s.results_show_breakdown AND c.entry_source = 'online' THEN
    SELECT questions INTO qs FROM exams WHERE id = s.exam_id;
    FOREACH i IN ARRAY COALESCE(c.question_order, ARRAY[]::integer[]) LOOP
      q := qs->i;
      IF q IS NOT NULL THEN
        breakdown := breakdown || jsonb_build_array(jsonb_build_object(
          'idx', i, 'question', q->>'question', 'image', q->>'image', 'imageTitle', q->>'imageTitle',
          'options', COALESCE(q->'answers', '[]'::jsonb), 'yourAnswer', c.answers->>i::text,
          'correctAnswer', q->>'correctAnswer', 'explanation', q->>'explanation',
          'correct', (c.answers->>i::text) IS NOT NULL AND (c.answers->>i::text) = (q->>'correctAnswer')));
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('candidateId', c.id, 'sessionCode', s.session_code,
    'candidateName', c.full_name, 'school', c.school, 'grade', c.grade,
    'examTitle', s.title, 'status', c.status, 'entrySource', c.entry_source,
    'timedOut',c.timed_out,'resultIncluded',c.include_in_results,
    'resultsOut', released, 'score', CASE WHEN released THEN c.score END,
    'total', CASE WHEN released THEN c.total_questions END, 'submittedAt', c.submitted_at,
    'linkedAt', c.account_linked_at, 'certificate', certificate_json, 'breakdown', breakdown,
    'showBreakdown', p_breakdown AND released AND s.results_show_breakdown AND c.entry_source = 'online');
END $$;

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
  SELECT * INTO s FROM exam_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That exam sitting no longer exists.'; END IF;

  PERFORM admin_finalize_expired_exams(p_session_id);

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
  IF _exam_finish(c.id) IS NOT NULL THEN RETURN jsonb_build_object('logged',false,'completed',true); END IF;
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
      timed_out=false, include_in_results=true, result_decided_at=NULL, result_decided_by=NULL, result_decision_reason=NULL,
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

CREATE OR REPLACE FUNCTION exam_claim_result(p_session_code text, p_access_code text, p_password text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  who uuid := auth.uid(); c exam_candidates; limit_row exam_claim_limits;
BEGIN
  IF who IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = who) THEN
    RETURN jsonb_build_object('error', 'Sign in to your Gifted account before saving an exam.');
  END IF;
  INSERT INTO exam_claim_limits(user_id) VALUES(who) ON CONFLICT DO NOTHING;
  SELECT * INTO limit_row FROM exam_claim_limits WHERE user_id = who FOR UPDATE;
  IF limit_row.window_started <= now() - interval '15 minutes' THEN
    UPDATE exam_claim_limits SET window_started = now(), failures = 0 WHERE user_id = who;
    limit_row.failures := 0;
  END IF;
  IF limit_row.failures >= 10 THEN
    RETURN jsonb_build_object('error', 'Too many incorrect attempts. Wait 15 minutes before trying your exam slip again.');
  END IF;
  -- Serialize competing claims on the candidate. A supplied user ID is never accepted.
  SELECT ec.* INTO c FROM exam_candidates ec JOIN exam_sessions es ON es.id = ec.session_id
    WHERE upper(es.session_code) = upper(trim(p_session_code))
      AND upper(ec.access_code) = upper(trim(p_access_code));
  IF c.id IS NULL OR p_password IS NULL OR length(p_password) > 200
      OR c.password_hash IS DISTINCT FROM crypt(p_password, c.password_hash) THEN
    UPDATE exam_claim_limits SET failures = failures + 1 WHERE user_id = who;
    RETURN jsonb_build_object('error', 'Those exam details did not match. Check the sitting code, access code and password on your slip.');
  END IF;
  PERFORM _exam_finish(c.id);
  SELECT * INTO c FROM exam_candidates WHERE id=c.id FOR UPDATE;
  IF c.user_id IS NOT NULL AND c.user_id <> who THEN
    UPDATE exam_claim_limits SET failures = failures + 1 WHERE user_id = who;
    RETURN jsonb_build_object('error', 'This exam is already linked to another account. Ask your exam administrator to review the link.');
  END IF;
  IF c.status <> 'submitted' THEN
    RETURN jsonb_build_object('error', 'Only a completed exam can be saved. Ask your invigilator if your attempt was stopped.');
  END IF;
  IF c.user_id = who THEN
    RETURN jsonb_build_object('linked', true, 'alreadyLinked', true, 'exam', _exam_account_result(c.id));
  END IF;
  UPDATE exam_candidates SET user_id = who, account_linked_at = now(), account_link_method = 'exam_credentials'
    WHERE id = c.id;
  PERFORM _exam_audit(c.session_id, c.id, who::text, 'candidate.claim_account',
    jsonb_build_object('userId', who, 'method', 'exam_credentials'), NULL);
  RETURN jsonb_build_object('linked', true, 'alreadyLinked', false, 'exam', _exam_account_result(c.id));
END $$;

-- Optional unattended sweep when Supabase Cron is already enabled. Without Cron,
-- the admin board, publication and candidate access still finalize due attempts.
DO $schedule$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
    PERFORM cron.schedule('gifted-exam-timeouts','* * * * *','SELECT public.admin_finalize_expired_exams();');
  END IF;
END $schedule$;
NOTIFY pgrst, 'reload schema';
COMMIT;
