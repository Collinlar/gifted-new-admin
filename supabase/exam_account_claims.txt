-- Run AFTER exam_paper_results.sql. Run this entire file through COMMIT.
-- Exam records stay in place; claiming only attaches an authenticated account.
BEGIN;

ALTER TABLE exam_candidates
  ADD COLUMN IF NOT EXISTS account_linked_at timestamptz,
  ADD COLUMN IF NOT EXISTS account_link_method text;
CREATE INDEX IF NOT EXISTS exam_candidates_user_idx ON exam_candidates(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS exam_claim_limits (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_started timestamptz NOT NULL DEFAULT now(),
  failures integer NOT NULL DEFAULT 0
);
ALTER TABLE exam_claim_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON exam_claim_limits FROM PUBLIC, anon, authenticated;

-- Narrow result payload: never exposes credentials, account IDs, or unreleased marks.
CREATE OR REPLACE FUNCTION _exam_account_result(p_candidate_id uuid, p_breakdown boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  c exam_candidates; s exam_sessions; cert certificates;
  released boolean; certificate_json jsonb := NULL; breakdown jsonb := '[]';
  qs jsonb; q jsonb; i integer;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  released := s.results_published_at IS NOT NULL AND c.status = 'submitted';
  IF c.status = 'submitted' THEN
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
    'resultsOut', released, 'score', CASE WHEN released THEN c.score END,
    'total', CASE WHEN released THEN c.total_questions END, 'submittedAt', c.submitted_at,
    'linkedAt', c.account_linked_at, 'certificate', certificate_json, 'breakdown', breakdown,
    'showBreakdown', p_breakdown AND released AND s.results_show_breakdown AND c.entry_source = 'online');
END $$;
REVOKE ALL ON FUNCTION _exam_account_result(uuid,boolean) FROM PUBLIC, anon, authenticated;

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
      AND upper(ec.access_code) = upper(trim(p_access_code)) FOR UPDATE OF ec;
  IF c.id IS NULL OR p_password IS NULL OR length(p_password) > 200
      OR c.password_hash IS DISTINCT FROM crypt(p_password, c.password_hash) THEN
    UPDATE exam_claim_limits SET failures = failures + 1 WHERE user_id = who;
    RETURN jsonb_build_object('error', 'Those exam details did not match. Check the sitting code, access code and password on your slip.');
  END IF;
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
REVOKE ALL ON FUNCTION exam_claim_result(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION exam_claim_result(text,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION exam_my_results()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE who uuid := auth.uid(); result jsonb;
BEGIN
  IF who IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = who) THEN
    RETURN jsonb_build_object('error', 'Sign in to see the exams saved to your account.');
  END IF;
  SELECT COALESCE(jsonb_agg(_exam_account_result(id) ORDER BY submitted_at DESC NULLS LAST, id), '[]'::jsonb)
    INTO result FROM exam_candidates WHERE user_id = who;
  RETURN jsonb_build_object('exams', result);
END $$;
REVOKE ALL ON FUNCTION exam_my_results() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION exam_my_results() TO authenticated;

CREATE OR REPLACE FUNCTION exam_my_result(p_candidate_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE who uuid := auth.uid();
BEGIN
  IF who IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = who) OR NOT EXISTS (
    SELECT 1 FROM exam_candidates WHERE id = p_candidate_id AND user_id = who
  ) THEN
    RETURN jsonb_build_object('error', 'This exam is not saved to your account.');
  END IF;
  RETURN _exam_account_result(p_candidate_id, true);
END $$;
REVOKE ALL ON FUNCTION exam_my_result(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION exam_my_result(uuid) TO authenticated;

-- Administrators may detach a mistaken claim after checking ownership, with an audit reason.
-- Reassignment still requires the rightful candidate to sign in and prove their credentials.
CREATE OR REPLACE FUNCTION admin_unlink_exam_account(p_candidate_id uuid, p_actor text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE c exam_candidates; secret text;
BEGIN
  IF length(trim(COALESCE(p_reason, ''))) < 3 THEN RAISE EXCEPTION 'Give a reason for removing this account link.'; END IF;
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.'; END IF;
  IF c.status NOT IN ('submitted', 'disqualified') THEN
    RAISE EXCEPTION 'Only completed or stopped exam records can have their account link removed here.';
  END IF;
  IF c.user_id IS NULL THEN RETURN jsonb_build_object('unlinked', false); END IF;
  secret := upper(encode(gen_random_bytes(6), 'hex'));
  UPDATE exam_candidates SET user_id = NULL, account_linked_at = NULL, account_link_method = NULL,
    password_plain = secret, password_hash = crypt(secret, gen_salt('bf')), token = NULL
    WHERE id = c.id;
  PERFORM _exam_audit(c.session_id, c.id, p_actor, 'candidate.unlink_account',
    jsonb_build_object('previousUserId', c.user_id), p_reason);
  RETURN jsonb_build_object('unlinked', true, 'credentialsRotated', true);
END $$;
REVOKE ALL ON FUNCTION admin_unlink_exam_account(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_unlink_exam_account(uuid,text,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
