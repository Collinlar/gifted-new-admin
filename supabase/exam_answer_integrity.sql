-- Exam answer integrity: immutable sitting papers, opaque option values,
-- server-truth result flags and an audited preview/apply score repair.
-- Run LAST, after exam_candidate_corrections.sql, exam_disqualified_review.sql
-- and certificate_payments.sql.
BEGIN;

ALTER TABLE exam_sessions
  ADD COLUMN IF NOT EXISTS questions_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS questions_snapshot_at timestamptz;

UPDATE exam_sessions s
   SET questions_snapshot = e.questions,
       questions_snapshot_at = now()
  FROM exams e
 WHERE e.id = s.exam_id AND s.questions_snapshot IS NULL;

CREATE OR REPLACE FUNCTION _exam_capture_questions_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF NEW.questions_snapshot IS NULL THEN
    SELECT questions INTO NEW.questions_snapshot FROM exams WHERE id = NEW.exam_id;
    NEW.questions_snapshot_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS exam_capture_questions_snapshot ON exam_sessions;
CREATE TRIGGER exam_capture_questions_snapshot BEFORE INSERT ON exam_sessions
  FOR EACH ROW EXECUTE FUNCTION _exam_capture_questions_snapshot();

CREATE OR REPLACE FUNCTION _exam_questions(p_session_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
  SELECT COALESCE(s.questions_snapshot, e.questions, '[]'::jsonb)
    FROM exam_sessions s JOIN exams e ON e.id=s.exam_id WHERE s.id=p_session_id
$$;

CREATE OR REPLACE FUNCTION _exam_option_values(q jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(q->'optionIds')='array' AND jsonb_array_length(q->'optionIds')=jsonb_array_length(COALESCE(q->'answers','[]'::jsonb))
      THEN q->'optionIds'
    WHEN jsonb_typeof(q->'answerValues')='array' THEN q->'answerValues'
    ELSE COALESCE(q->'answers','[]'::jsonb)
  END
$$;

CREATE OR REPLACE FUNCTION _exam_correct_value(q jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE idx integer;
BEGIN
  IF NULLIF(q->>'correctOptionId','') IS NOT NULL THEN RETURN q->>'correctOptionId'; END IF;
  IF (q ? 'correctAnswerIndex') AND (q->>'correctAnswerIndex') ~ '^\d+$' THEN
    idx := (q->>'correctAnswerIndex')::integer;
    IF idx >= 0 AND idx < jsonb_array_length(_exam_option_values(q)) THEN
      RETURN _exam_option_values(q)->>idx;
    END IF;
  END IF;
  RETURN COALESCE(q->>'correctValue', q->>'correctAnswer');
END $$;

CREATE OR REPLACE FUNCTION _exam_correct_text(q jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE idx integer;
BEGIN
  IF (q ? 'correctAnswerIndex') AND (q->>'correctAnswerIndex') ~ '^\d+$' THEN
    idx := (q->>'correctAnswerIndex')::integer;
    IF idx >= 0 AND idx < jsonb_array_length(COALESCE(q->'answers','[]'::jsonb)) THEN
      RETURN q->'answers'->>idx;
    END IF;
  END IF;
  RETURN q->>'correctAnswer';
END $$;

CREATE OR REPLACE FUNCTION _exam_answer_is_correct(q jsonb, given text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT given IS NOT NULL AND _exam_correct_value(q) IS NOT NULL AND given=_exam_correct_value(q)
$$;

CREATE OR REPLACE FUNCTION _exam_finish(p_candidate_id uuid, p_answers jsonb DEFAULT NULL, p_expiry_only boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions; due boolean; qs jsonb; final jsonb := '{}';
  saved jsonb := '{}'; source_answers jsonb := '{}'; q jsonb;
  i integer; given text; hits integer := 0; total integer; answered integer := 0;
BEGIN
  SELECT session_id INTO c.session_id FROM exam_candidates WHERE id=p_candidate_id;
  SELECT * INTO s FROM exam_sessions WHERE id=c.session_id FOR UPDATE;
  SELECT * INTO c FROM exam_candidates WHERE id=p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  IF c.status='submitted' THEN RETURN _exam_submission_result(c.id); END IF;
  IF c.status<>'in_progress' OR c.entry_source<>'online' THEN RETURN NULL; END IF;
  due := c.expires_at IS NOT NULL AND c.expires_at<=COALESCE(s.paused_at,now());
  IF p_expiry_only AND NOT due THEN RETURN NULL; END IF;
  IF s.paused_at IS NOT NULL AND NOT due THEN RAISE EXCEPTION 'The exam is paused. Wait for your invigilator to resume it.'; END IF;
  qs := _exam_questions(s.id); total := jsonb_array_length(qs);
  saved := _exam_current_answers(c.id);
  source_answers := CASE WHEN due THEN saved ELSE COALESCE(p_answers,saved) END;
  FOR i IN 0..total-1 LOOP
    q := qs->i; given := source_answers->>i::text;
    IF given IS NOT NULL THEN
      final := final||jsonb_build_object(i::text,given); answered:=answered+1;
      IF _exam_answer_is_correct(q,given) THEN hits:=hits+1; END IF;
    END IF;
    IF given IS DISTINCT FROM (saved->>i::text) THEN
      INSERT INTO exam_answer_log(candidate_id,question_idx,answer,previous_answer)
      VALUES(c.id,i,given,saved->>i::text);
    END IF;
  END LOOP;
  UPDATE exam_candidates SET answers=final,score=hits,total_questions=total,status='submitted',
    submitted_at=CASE WHEN due THEN c.expires_at ELSE now() END,timed_out=due WHERE id=c.id;
  INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id,CASE WHEN due THEN 'auto_submit' ELSE 'submit' END,
    jsonb_build_object('score',hits,'total',total,'answered',answered,'timedOut',due,'savedAnswersOnly',due,
      'answerHistoryRecovered',saved IS DISTINCT FROM c.answers,'answerKey','sitting_snapshot'));
  IF due THEN
    PERFORM _exam_audit(c.session_id,c.id,'system','candidate.timeout',
      jsonb_build_object('score',hits,'total',total,'answered',answered,'expiresAt',c.expires_at,
        'answerHistoryRecovered',saved IS DISTINCT FROM c.answers,'answerKey','sitting_snapshot'),NULL);
  END IF;
  RETURN _exam_submission_result(c.id);
END $$;

CREATE OR REPLACE FUNCTION exam_get_paper(p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions; instructions_ jsonb; qs jsonb; out_questions jsonb:='[]'; q jsonb; i integer;
BEGIN
  c:=_exam_resolve(p_token);
  IF _exam_finish(c.id) IS NOT NULL THEN RETURN jsonb_build_object('completed',true,'submission',_exam_submission_result(c.id)); END IF;
  SELECT * INTO s FROM exam_sessions WHERE id=c.session_id;
  SELECT COALESCE(to_jsonb(instructions),'[]'::jsonb) INTO instructions_ FROM exams WHERE id=s.exam_id;
  qs:=_exam_questions(s.id);
  FOREACH i IN ARRAY COALESCE(c.question_order,ARRAY[]::integer[]) LOOP
    q:=qs->i; CONTINUE WHEN q IS NULL;
    out_questions:=out_questions||jsonb_build_array(jsonb_build_object(
      'idx',i,'question',q->>'question','image',q->>'image','imageTitle',q->>'imageTitle',
      'media',COALESCE(q->'media','[]'::jsonb),'answerMedia',COALESCE(q->'answerMedia','[]'::jsonb),
      'answerValues',_exam_option_values(q),'answers',COALESCE(q->'answers','[]'::jsonb)));
  END LOOP;
  UPDATE exam_candidates SET last_seen_at=now() WHERE id=c.id;
  RETURN jsonb_build_object('examTitle',s.title,'candidateName',c.full_name,'instructions',instructions_,
    'questions',out_questions,'savedAnswers',c.answers,'expiresAt',c.expires_at,'serverNow',now(),
    'paused',s.paused_at IS NOT NULL,'maxTabSwitches',s.max_tab_switches,'tabSwitches',c.tab_switches);
END $$;

CREATE OR REPLACE FUNCTION admin_get_transcript(p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions; qs jsonb; rows_ jsonb:='[]'; q jsonb; i integer;
  given text; changed jsonb; correct_idx jsonb;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id=p_candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  SELECT * INTO s FROM exam_sessions WHERE id=c.session_id; qs:=_exam_questions(s.id);
  FOREACH i IN ARRAY COALESCE(c.question_order,ARRAY[]::integer[]) LOOP
    q:=qs->i; CONTINUE WHEN q IS NULL; given:=c.answers->>i::text;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('at',l.created_at,'from',l.previous_answer,'to',l.answer)
      ORDER BY l.created_at,l.id),'[]'::jsonb) INTO changed FROM exam_answer_log l
      WHERE l.candidate_id=c.id AND l.question_idx=i AND c.started_at IS NOT NULL AND l.created_at>=c.started_at;
    rows_:=rows_||jsonb_build_array(jsonb_build_object('idx',i,'question',q->>'question',
      'options',COALESCE(q->'answers','[]'::jsonb),'image',q->>'image','imageTitle',q->>'imageTitle',
      'media',COALESCE(q->'media','[]'::jsonb),'answerMedia',COALESCE(q->'answerMedia','[]'::jsonb),
      'answerValues',_exam_option_values(q),'correctAnswerIndex',q->'correctAnswerIndex',
      'yourAnswer',given,'correctAnswer',_exam_correct_text(q),'correctValue',_exam_correct_value(q),
      'correct',_exam_answer_is_correct(q,given),'history',changed));
  END LOOP;
  RETURN jsonb_build_object('candidate',jsonb_build_object('id',c.id,'name',c.full_name,'school',c.school,
    'grade',c.grade,'accessCode',c.access_code,'status',c.status,'startedAt',c.started_at,
    'submittedAt',c.submitted_at,'expiresAt',c.expires_at,'score',c.score,'total',c.total_questions,
    'tabSwitches',c.tab_switches),'sitting',jsonb_build_object('id',s.id,'title',s.title,'code',s.session_code),
    'questions',rows_,'events',COALESCE((SELECT jsonb_agg(jsonb_build_object('at',e.created_at,'type',e.type,'meta',e.meta)
      ORDER BY e.created_at) FROM exam_events e WHERE e.candidate_id=c.id),'[]'::jsonb),
    'adminActions',COALESCE((SELECT jsonb_agg(jsonb_build_object('at',a.created_at,'actor',a.actor_email,
      'action',a.action,'reason',a.reason,'detail',a.detail) ORDER BY a.created_at)
      FROM exam_audit_log a WHERE a.candidate_id=c.id),'[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION _exam_result_breakdown(p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; qs jsonb; out_ jsonb:='[]'; q jsonb; i integer; given text;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id=p_candidate_id;
  IF NOT FOUND OR c.entry_source<>'online' THEN RETURN out_; END IF;
  qs:=_exam_questions(c.session_id);
  FOREACH i IN ARRAY COALESCE(c.question_order,ARRAY[]::integer[]) LOOP
    q:=qs->i; CONTINUE WHEN q IS NULL; given:=c.answers->>i::text;
    out_:=out_||jsonb_build_array(jsonb_build_object('idx',i,'question',q->>'question',
      'image',q->>'image','imageTitle',q->>'imageTitle','media',COALESCE(q->'media','[]'::jsonb),
      'answerMedia',COALESCE(q->'answerMedia','[]'::jsonb),'answers',COALESCE(q->'answers','[]'::jsonb),
      'options',COALESCE(q->'answers','[]'::jsonb),'answerValues',_exam_option_values(q),
      'correctAnswerIndex',q->'correctAnswerIndex','yourAnswer',given,
      'correctAnswer',_exam_correct_text(q),'correctValue',_exam_correct_value(q),
      'explanation',q->>'explanation','correct',_exam_answer_is_correct(q,given)));
  END LOOP;
  RETURN out_;
END $$;

CREATE OR REPLACE FUNCTION _exam_score_disqualified()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE qs jsonb; i integer; hits integer:=0; total integer; given text;
BEGIN
  IF NEW.status='disqualified' THEN
    IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'disqualified' OR OLD.review_scored_at IS NULL THEN
      NEW.pre_disqualification_included:=CASE WHEN TG_OP='INSERT' THEN NEW.include_in_results ELSE OLD.include_in_results END;
      IF NEW.entry_source='online' AND (NEW.submitted_at IS NULL OR NEW.score IS NULL OR NEW.total_questions IS NULL) THEN
        qs:=_exam_questions(NEW.session_id); total:=jsonb_array_length(qs);
        FOR i IN 0..total-1 LOOP
          given:=NEW.answers->>i::text;
          IF _exam_answer_is_correct(qs->i,given) THEN hits:=hits+1; END IF;
        END LOOP;
        NEW.score:=hits; NEW.total_questions:=total;
      END IF;
      NEW.review_scored_at:=now();
    ELSIF NEW.answers IS DISTINCT FROM OLD.answers OR NEW.score IS DISTINCT FROM OLD.score
       OR NEW.total_questions IS DISTINCT FROM OLD.total_questions THEN
      RAISE EXCEPTION 'This disqualified attempt is frozen for review. Reinstate it through the invigilator controls before changing its work.';
    END IF;
    NEW.include_in_results:=false; NEW.token:=NULL;
  ELSIF TG_OP='UPDATE' AND OLD.status='disqualified' THEN
    NEW.include_in_results:=CASE WHEN NEW.status='pending' THEN true ELSE COALESCE(OLD.pre_disqualification_included,true) END;
    IF NEW.status IN ('pending','in_progress') THEN NEW.score:=NULL; END IF;
    NEW.review_scored_at:=NULL; NEW.pre_disqualification_included:=NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION _exam_account_result(p_candidate_id uuid, p_breakdown boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; s exam_sessions; cert certificates; released boolean;
  certificate_json jsonb:=NULL; breakdown jsonb:='[]'; access_json jsonb;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id=p_candidate_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM _exam_finish(c.id); SELECT * INTO c FROM exam_candidates WHERE id=p_candidate_id;
  SELECT * INTO s FROM exam_sessions WHERE id=c.session_id; access_json:=_cert_access(c.id);
  released:=s.results_published_at IS NOT NULL AND c.status='submitted' AND c.include_in_results;
  IF c.status='submitted' AND c.include_in_results THEN
    SELECT * INTO cert FROM certificates WHERE candidate_id=c.id AND session_id=s.id AND revoked_at IS NULL LIMIT 1;
    IF FOUND THEN certificate_json:=jsonb_build_object('serial',cert.serial,'downloadKey',cert.download_key,'band',cert.band); END IF;
  END IF;
  IF p_breakdown AND released AND s.results_show_breakdown AND c.entry_source='online' THEN breakdown:=_exam_result_breakdown(c.id); END IF;
  RETURN jsonb_build_object('candidateId',c.id,'sessionCode',s.session_code,'candidateName',c.full_name,
    'school',c.school,'grade',c.grade,'examTitle',s.title,'status',c.status,'entrySource',c.entry_source,
    'timedOut',c.timed_out,'resultIncluded',c.include_in_results,'resultsOut',released,
    'score',CASE WHEN released THEN c.score END,'total',CASE WHEN released THEN c.total_questions END,
    'submittedAt',c.submitted_at,'linkedAt',c.account_linked_at,'certificate',certificate_json,
    'certificateAccess',access_json,'breakdown',breakdown,
    'showBreakdown',p_breakdown AND released AND s.results_show_breakdown AND c.entry_source='online');
END $$;

CREATE OR REPLACE FUNCTION exam_candidate_login(
  p_session_code text,p_access_code text,p_password text,p_fingerprint text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE s exam_sessions; c exam_candidates; cert certificates; cert_json jsonb:=NULL;
  new_token uuid; n_questions integer; breakdown jsonb:='[]';
BEGIN
  SELECT * INTO s FROM exam_sessions WHERE upper(session_code)=upper(trim(p_session_code));
  IF NOT FOUND THEN RETURN jsonb_build_object('error','We could not find that exam. Check the link and try again.'); END IF;
  SELECT * INTO c FROM exam_candidates WHERE session_id=s.id AND upper(access_code)=upper(trim(p_access_code));
  IF NOT FOUND OR p_password IS NULL OR c.password_hash IS DISTINCT FROM crypt(p_password,c.password_hash) THEN
    IF FOUND THEN INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id,'failed_login',jsonb_build_object('fingerprint',p_fingerprint)); END IF;
    RETURN jsonb_build_object('error','Those details did not match. Check your access code and password.');
  END IF;
  IF c.status='disqualified' THEN RETURN jsonb_build_object('error','This attempt was stopped. Contact your invigilator for a review.'); END IF;
  PERFORM _exam_finish(c.id); SELECT * INTO c FROM exam_candidates WHERE id=c.id;
  IF c.status='submitted' THEN
    IF NOT c.include_in_results THEN RETURN jsonb_build_object('mode','results','candidateName',c.full_name,
      'examTitle',s.title,'resultsOut',false,'resultIncluded',false,'timedOut',c.timed_out,'entrySource',c.entry_source); END IF;
    SELECT * INTO cert FROM certificates WHERE candidate_id=c.id AND session_id=s.id AND revoked_at IS NULL LIMIT 1;
    IF FOUND THEN cert_json:=jsonb_build_object('serial',cert.serial,'downloadKey',cert.download_key,'band',cert.band); END IF;
    IF s.results_published_at IS NULL AND cert_json IS NULL THEN
      RETURN jsonb_build_object('error','You have already submitted this exam. Results are not out yet.'); END IF;
    IF s.results_published_at IS NOT NULL AND s.results_show_breakdown AND c.entry_source='online' THEN
      breakdown:=_exam_result_breakdown(c.id); END IF;
    INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id,'viewed_results','{}'::jsonb);
    RETURN jsonb_build_object('mode','results','candidateName',c.full_name,'examTitle',s.title,
      'resultsOut',s.results_published_at IS NOT NULL,
      'score',CASE WHEN s.results_published_at IS NOT NULL THEN c.score END,
      'total',CASE WHEN s.results_published_at IS NOT NULL THEN c.total_questions END,
      'submittedAt',c.submitted_at,'breakdown',breakdown,'entrySource',c.entry_source,
      'resultIncluded',c.include_in_results,'timedOut',c.timed_out,
      'showBreakdown',s.results_published_at IS NOT NULL AND s.results_show_breakdown AND c.entry_source='online',
      'certificate',cert_json);
  END IF;
  IF s.paused_at IS NOT NULL THEN RETURN jsonb_build_object('error','The exam is paused. Wait for your invigilator to resume it.'); END IF;
  IF s.status='closed' THEN RETURN jsonb_build_object('error','This exam has closed.'); END IF;
  IF s.starts_at IS NOT NULL AND now()<s.starts_at THEN RETURN jsonb_build_object('error','This exam has not opened yet.'); END IF;
  IF s.ends_at IS NOT NULL AND now()>s.ends_at THEN RETURN jsonb_build_object('error','This exam has closed.'); END IF;
  IF s.lock_to_device AND c.device_fingerprint IS NOT NULL AND p_fingerprint IS NOT NULL
     AND c.device_fingerprint<>p_fingerprint THEN
    INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id,'device_mismatch',jsonb_build_object('expected',c.device_fingerprint,'got',p_fingerprint));
    RETURN jsonb_build_object('error','This exam was started on another device. Ask your invigilator to release it.');
  END IF;
  n_questions:=jsonb_array_length(_exam_questions(s.id)); new_token:=gen_random_uuid();
  UPDATE exam_candidates SET token=new_token,token_issued_at=now(),device_fingerprint=COALESCE(c.device_fingerprint,p_fingerprint),
    status=CASE WHEN c.status='pending' THEN 'in_progress' ELSE c.status END,started_at=COALESCE(c.started_at,now()),
    expires_at=COALESCE(c.expires_at,now()+make_interval(mins=>s.duration_minutes)),
    total_questions=COALESCE(c.total_questions,n_questions),last_seen_at=now(),question_order=COALESCE(c.question_order,
      CASE WHEN s.shuffle_questions THEN (SELECT array_agg(x ORDER BY random()) FROM generate_series(0,n_questions-1)x)
           ELSE (SELECT array_agg(x ORDER BY x) FROM generate_series(0,n_questions-1)x) END) WHERE id=c.id;
  INSERT INTO exam_events(candidate_id,type,meta) VALUES(c.id,'login',jsonb_build_object('fingerprint',p_fingerprint));
  RETURN jsonb_build_object('mode','exam','token',new_token,'candidateName',c.full_name,'examTitle',s.title);
END $$;

-- Preview first; p_apply=true performs audited online-candidate corrections.
CREATE OR REPLACE FUNCTION admin_recalculate_session_scores(
  p_session_id uuid, p_actor text, p_reason text, p_apply boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; qs jsonb; q jsonb; i integer; hits integer; changed integer:=0; preview jsonb:='[]';
BEGIN
  IF p_apply AND length(trim(COALESCE(p_reason,'')))<3 THEN RAISE EXCEPTION 'Give a reason before applying score corrections.'; END IF;
  qs:=_exam_questions(p_session_id);
  FOR c IN SELECT * FROM exam_candidates WHERE session_id=p_session_id AND status='submitted' AND entry_source='online' ORDER BY id LOOP
    hits:=0;
    FOR i IN 0..jsonb_array_length(qs)-1 LOOP q:=qs->i;
      IF _exam_answer_is_correct(q,c.answers->>i::text) THEN hits:=hits+1; END IF;
    END LOOP;
    IF hits IS DISTINCT FROM c.score THEN
      changed:=changed+1; preview:=preview||jsonb_build_array(jsonb_build_object(
        'candidateId',c.id,'name',c.full_name,'before',c.score,'after',hits));
      IF p_apply THEN
        UPDATE exam_candidates SET score=hits WHERE id=c.id;
        PERFORM _exam_audit(p_session_id,c.id,p_actor,'candidate.score_recalculated',
          jsonb_build_object('before',c.score,'after',hits,'answerKey','sitting_snapshot'),p_reason);
      END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('apply',p_apply,'changed',changed,'candidates',preview);
END $$;

REVOKE ALL ON FUNCTION _exam_capture_questions_snapshot() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _exam_questions(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _exam_option_values(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _exam_correct_value(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _exam_correct_text(jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _exam_answer_is_correct(jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _exam_result_breakdown(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION admin_recalculate_session_scores(uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION admin_recalculate_session_scores(uuid,text,text,boolean) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
