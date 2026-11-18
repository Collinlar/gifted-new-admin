-- Run after exam_disqualified_review.sql and certificates.sql. Safe to rerun.
-- Adds audited candidate identity corrections and keeps answer history scoped to
-- the current attempt after an administrator resets a candidate.
BEGIN;

CREATE OR REPLACE FUNCTION admin_update_exam_candidate(
  p_candidate_id uuid,
  p_full_name text,
  p_school text,
  p_grade text,
  p_actor text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c exam_candidates;
  cert certificates;
  new_name text := trim(COALESCE(p_full_name, ''));
  new_school text := NULLIF(trim(COALESCE(p_school, '')), '');
  new_grade text := NULLIF(trim(COALESCE(p_grade, '')), '');
  why text := trim(COALESCE(p_reason, ''));
  reissued jsonb := NULL;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  IF length(new_name) < 2 OR length(new_name) > 160 THEN
    RAISE EXCEPTION 'Enter the candidate name using 2 to 160 characters.';
  END IF;
  IF length(COALESCE(new_school, '')) > 200 THEN RAISE EXCEPTION 'School must be 200 characters or fewer.'; END IF;
  IF length(COALESCE(new_grade, '')) > 80 THEN RAISE EXCEPTION 'Grade must be 80 characters or fewer.'; END IF;
  IF length(why) < 3 OR length(why) > 500 THEN RAISE EXCEPTION 'Give a reason using 3 to 500 characters.'; END IF;

  IF c.full_name IS NOT DISTINCT FROM new_name
     AND c.school IS NOT DISTINCT FROM new_school
     AND c.grade IS NOT DISTINCT FROM new_grade THEN
    RETURN jsonb_build_object('changed', false, 'candidate', jsonb_build_object(
      'id', c.id, 'fullName', c.full_name, 'school', c.school, 'grade', c.grade),
      'certificateReissued', false);
  END IF;

  UPDATE exam_candidates SET full_name = new_name, school = new_school, grade = new_grade
   WHERE id = c.id;

  PERFORM _exam_audit(c.session_id, c.id, p_actor, 'candidate.profile_update',
    jsonb_build_object(
      'before', jsonb_build_object('fullName', c.full_name, 'school', c.school, 'grade', c.grade),
      'after', jsonb_build_object('fullName', new_name, 'school', new_school, 'grade', new_grade)
    ), why);

  -- Certificates are intentionally frozen records. Replace an active one so a
  -- corrected name/school is reflected and the old downloaded serial verifies
  -- as revoked instead of silently changing under the same serial.
  SELECT * INTO cert FROM certificates
   WHERE candidate_id = c.id AND session_id = c.session_id AND revoked_at IS NULL
   ORDER BY issued_at DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    reissued := admin_reissue_certificate(cert.id, p_actor, 'Candidate details corrected: ' || why);
    IF NOT COALESCE((reissued->>'issued')::boolean, false) THEN
      RAISE EXCEPTION 'The correction could not replace the active certificate: %',
        COALESCE(reissued->>'reason', 'certificate reissue failed');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'changed', true,
    'candidate', jsonb_build_object('id', c.id, 'fullName', new_name, 'school', new_school, 'grade', new_grade),
    'certificateReissued', COALESCE((reissued->>'issued')::boolean, false),
    'certificate', reissued
  );
END;
$$;

-- Rebuild the answer state using only changes made since this attempt began.
-- This protects timeout scoring if a stale whole-answer autosave overwrote the
-- snapshot, while never carrying answers from an earlier reset into a new try.
CREATE OR REPLACE FUNCTION _exam_current_answers(p_candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE c exam_candidates; reconstructed jsonb; r record;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  reconstructed := COALESCE(c.answers, '{}'::jsonb);
  IF c.started_at IS NULL THEN RETURN reconstructed; END IF;
  FOR r IN
    SELECT DISTINCT ON (question_idx) question_idx, answer
      FROM exam_answer_log
     WHERE candidate_id = c.id AND created_at >= c.started_at
     ORDER BY question_idx, created_at DESC, id DESC
  LOOP
    IF r.answer IS NULL THEN reconstructed := reconstructed - r.question_idx::text;
    ELSE reconstructed := reconstructed || jsonb_build_object(r.question_idx::text, r.answer); END IF;
  END LOOP;
  RETURN reconstructed;
END;
$$;

CREATE OR REPLACE FUNCTION _exam_finish(p_candidate_id uuid, p_answers jsonb DEFAULT NULL, p_expiry_only boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions; due boolean; qs jsonb; final jsonb := '{}';
  saved jsonb := '{}'; source_answers jsonb := '{}';
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
  saved := _exam_current_answers(c.id);
  source_answers := CASE WHEN due THEN saved ELSE COALESCE(p_answers, saved) END;
  FOR i IN 0..total-1 LOOP
    given := source_answers->>i::text;
    IF given IS NOT NULL THEN
      final := final || jsonb_build_object(i::text, given); answered := answered + 1;
      IF given = (qs->i->>'correctAnswer') THEN hits := hits + 1; END IF;
    END IF;
    IF given IS DISTINCT FROM (saved->>i::text) THEN
      INSERT INTO exam_answer_log(candidate_id, question_idx, answer, previous_answer)
        VALUES(c.id, i, given, saved->>i::text);
    END IF;
  END LOOP;
  UPDATE exam_candidates SET answers = final, score = hits, total_questions = total,
    status = 'submitted', submitted_at = CASE WHEN due THEN c.expires_at ELSE now() END,
    timed_out = due WHERE id = c.id;
  INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id, CASE WHEN due THEN 'auto_submit' ELSE 'submit' END,
    jsonb_build_object('score',hits,'total',total,'answered',answered,'timedOut',due,'savedAnswersOnly',due,
      'answerHistoryRecovered', saved IS DISTINCT FROM c.answers));
  IF due THEN
    PERFORM _exam_audit(c.session_id,c.id,'system','candidate.timeout',
      jsonb_build_object('score',hits,'total',total,'answered',answered,'expiresAt',c.expires_at,
        'answerHistoryRecovered', saved IS DISTINCT FROM c.answers),NULL);
    IF s.results_published_at IS NOT NULL AND s.certificate_mode = 'on_publish' THEN
      BEGIN PERFORM _cert_issue(c.id, 'system (timeout after publication)');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id,'certificate_failed',jsonb_build_object('error',SQLERRM));
      END;
    END IF;
  END IF;
  RETURN _exam_submission_result(c.id);
END $$;

CREATE OR REPLACE FUNCTION admin_get_transcript(p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions; qs jsonb; rows_ jsonb := '[]'::jsonb;
  q jsonb; i integer; given text; correct text; changed jsonb;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  SELECT questions INTO qs FROM exams WHERE id = s.exam_id;
  FOREACH i IN ARRAY COALESCE(c.question_order, ARRAY[]::integer[]) LOOP
    q := qs -> i; CONTINUE WHEN q IS NULL;
    given := c.answers ->> i::text; correct := q ->> 'correctAnswer';
    SELECT COALESCE(jsonb_agg(jsonb_build_object('at',l.created_at,'from',l.previous_answer,'to',l.answer)
      ORDER BY l.created_at,l.id),'[]'::jsonb) INTO changed
      FROM exam_answer_log l WHERE l.candidate_id=c.id AND l.question_idx=i
        AND c.started_at IS NOT NULL AND l.created_at >= c.started_at;
    rows_ := rows_ || jsonb_build_array(jsonb_build_object(
      'idx',i,'question',q->>'question','options',COALESCE(q->'answers','[]'::jsonb),
      'image',q->>'image','imageTitle',q->>'imageTitle','media',COALESCE(q->'media','[]'::jsonb),
      'answerMedia',COALESCE(q->'answerMedia','[]'::jsonb),
      'yourAnswer',given,'correctAnswer',correct,'correct',given IS NOT NULL AND given=correct,'history',changed));
  END LOOP;
  RETURN jsonb_build_object(
    'candidate',jsonb_build_object('id',c.id,'name',c.full_name,'school',c.school,'grade',c.grade,
      'accessCode',c.access_code,'status',c.status,'startedAt',c.started_at,'submittedAt',c.submitted_at,
      'expiresAt',c.expires_at,'score',c.score,'total',c.total_questions,'tabSwitches',c.tab_switches),
    'sitting',jsonb_build_object('id',s.id,'title',s.title,'code',s.session_code),'questions',rows_,
    'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('at',e.created_at,'type',e.type,'meta',e.meta)
      ORDER BY e.created_at) FROM exam_events e WHERE e.candidate_id=c.id),'[]'::jsonb),
    'adminActions',COALESCE((SELECT jsonb_agg(jsonb_build_object('at',a.created_at,'actor',a.actor_email,
      'action',a.action,'reason',a.reason,'detail',a.detail) ORDER BY a.created_at)
      FROM exam_audit_log a WHERE a.candidate_id=c.id),'[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION admin_update_exam_candidate(uuid,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _exam_current_answers(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _exam_finish(uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION admin_get_transcript(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION admin_update_exam_candidate(uuid,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION admin_get_transcript(uuid) TO service_role;

COMMIT;
