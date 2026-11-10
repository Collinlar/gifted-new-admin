-- Run LAST, after certificates.sql and exam_results_images.sql.
-- Adds paper results to the existing sitting/roster/publication pipeline.
BEGIN;

ALTER TABLE exam_candidates
  ADD COLUMN IF NOT EXISTS entry_source text NOT NULL DEFAULT 'online'
    CHECK (entry_source IN ('online', 'paper')),
  ADD COLUMN IF NOT EXISTS candidate_reference text,
  ADD COLUMN IF NOT EXISTS import_batch_id uuid,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS imported_by text;
ALTER TABLE exam_candidates ALTER COLUMN score TYPE numeric USING score::numeric;
ALTER TABLE exam_candidates ALTER COLUMN total_questions TYPE numeric USING total_questions::numeric;
CREATE UNIQUE INDEX IF NOT EXISTS exam_candidate_reference_unique
  ON exam_candidates(session_id, upper(trim(candidate_reference)))
  WHERE candidate_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS exam_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  filename text NOT NULL, actor_email text NOT NULL, reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  added integer NOT NULL, updated integer NOT NULL, skipped integer NOT NULL
);
ALTER TABLE exam_import_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON exam_import_batches FROM anon, authenticated;
GRANT ALL ON exam_import_batches TO service_role;

-- Prevent online controls from resetting, re-scoring, or starting paper records.
CREATE OR REPLACE FUNCTION _exam_guard_paper() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF NEW.entry_source = 'paper' AND
    (NEW.status NOT IN ('submitted', 'disqualified') OR NEW.score IS NULL OR
     NEW.total_questions IS NULL OR NEW.total_questions <= 0 OR NEW.score < 0 OR
     NEW.score > NEW.total_questions OR NEW.submitted_at IS NULL OR
     NEW.answers <> '{}'::jsonb OR NEW.question_order IS NOT NULL) THEN
    RAISE EXCEPTION 'Paper results must remain completed records. Correct marks through the paper results importer.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS exam_guard_paper ON exam_candidates;
CREATE TRIGGER exam_guard_paper BEFORE INSERT OR UPDATE ON exam_candidates
  FOR EACH ROW EXECUTE FUNCTION _exam_guard_paper();

CREATE OR REPLACE FUNCTION admin_import_paper_results(
  p_session_id uuid, p_rows jsonb, p_actor text, p_filename text DEFAULT '',
  p_commit boolean DEFAULT false, p_review text DEFAULT NULL,
  p_correct boolean DEFAULT false, p_reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  s exam_sessions; c exam_candidates; r jsonb; item jsonb;
  report jsonb := '[]'; problems integer := 0; n integer := 0;
  ref text; fullname text; schoolname text; classname text; marks numeric; maximum numeric;
  action text; problem text; matches text; review text; roster text;
  batch uuid := gen_random_uuid(); target uuid; secret text; access text;
  added integer := 0; updated integer := 0; skipped integer := 0;
BEGIN
  SELECT * INTO s FROM exam_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exam sitting not found.'; END IF;
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Expected candidate rows.'; END IF;
  IF jsonb_array_length(p_rows) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'Upload between 1 and 2,000 candidates per batch.';
  END IF;
  -- Lock the roster, and bind the review to its current data and publication settings.
  PERFORM id FROM exam_candidates WHERE session_id = p_session_id ORDER BY id FOR UPDATE;
  SELECT string_agg(to_jsonb(x)::text, '' ORDER BY x.id) INTO roster
    FROM exam_candidates x WHERE session_id = p_session_id;
  review := encode(digest(COALESCE(roster, '') || to_jsonb(s)::text || p_rows::text ||
    p_correct::text, 'sha256'), 'hex');
  IF p_commit AND p_review IS DISTINCT FROM review THEN
    RAISE EXCEPTION 'The sitting or import changed since review. Review the file again.';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    n := n + 1; problem := NULL; matches := NULL; action := 'add';
    ref := upper(trim(r->>'reference')); fullname := trim(r->>'fullName');
    schoolname := trim(COALESCE(r->>'school', '')); classname := trim(COALESCE(r->>'grade', ''));
    IF COALESCE(ref, '') = '' OR COALESCE(fullname, '') = '' THEN
      problem := 'Candidate reference and full name are required.';
    ELSIF length(ref) > 200 OR length(fullname) > 200 OR length(schoolname) > 200 OR length(classname) > 200 THEN
      problem := 'Candidate fields must be at most 200 characters.';
    ELSIF COALESCE(r->>'score', '') !~ '^\d+(\.\d{1,2})?$' OR COALESCE(r->>'maximum', '') !~ '^\d+(\.\d{1,2})?$'
      OR length(r->>'score') > 20 OR length(r->>'maximum') > 20 THEN
      problem := 'Marks must be numbers with up to two decimal places.';
    ELSE
      marks := (r->>'score')::numeric; maximum := (r->>'maximum')::numeric;
      IF maximum <= 0 OR maximum > 1000000 OR marks > maximum THEN
        problem := 'Marks must be between zero and a positive maximum, up to 1,000,000.';
      END IF;
    END IF;
    IF (SELECT count(*) FROM jsonb_array_elements(p_rows) v WHERE upper(trim(v->>'reference')) = ref) > 1 THEN
      problem := 'This reference appears more than once in the file.';
    END IF;
    SELECT * INTO c FROM exam_candidates WHERE session_id = p_session_id
      AND (upper(trim(candidate_reference)) = ref OR (entry_source = 'online' AND upper(access_code) = ref))
      ORDER BY (entry_source = 'online') DESC LIMIT 1;
    IF FOUND THEN
      IF c.entry_source <> 'paper' THEN
        problem := 'This reference belongs to an online candidate. It cannot be overwritten.';
      ELSIF c.status = 'disqualified' THEN
        problem := 'This candidate was stopped. Resolve their standing before importing.';
      ELSIF c.full_name = fullname AND COALESCE(c.school, '') = schoolname
          AND COALESCE(c.grade, '') = classname AND c.score = marks AND c.total_questions = maximum THEN
        action := 'skip';
      ELSE
        action := 'update';
        IF NOT p_correct THEN problem := 'Existing result differs. Enable corrections and give a reason.';
        ELSIF length(trim(COALESCE(p_reason, ''))) < 3 THEN problem := 'A correction reason is required.';
        ELSIF EXISTS (SELECT 1 FROM certificates WHERE candidate_id = c.id AND revoked_at IS NULL) THEN
          problem := 'Withdraw this candidate''s certificate before correcting their result.';
        END IF;
      END IF;
    ELSE
      SELECT string_agg(full_name || ' (' || COALESCE(candidate_reference, access_code) || ')', ', ')
        INTO matches FROM exam_candidates WHERE session_id = p_session_id
          AND lower(trim(full_name)) = lower(fullname);
      IF matches IS NOT NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) v
        WHERE lower(trim(v->>'fullName')) = lower(fullname) AND upper(trim(v->>'reference')) <> ref) THEN
        matches := COALESCE(matches, 'Another row in this file has the same name');
        IF COALESCE(r->>'distinct', 'false') <> 'true' THEN
          problem := 'Possible duplicate. Use the existing reference, or confirm this is a different person.';
        END IF;
      END IF;
    END IF;
    IF action <> 'skip' AND s.results_published_at IS NOT NULL THEN
      problem := 'Withdraw published results before adding or correcting paper results, then publish the combined results again.';
    END IF;
    IF problem IS NOT NULL THEN problems := problems + 1; END IF;
    report := report || jsonb_build_array(jsonb_build_object('row', n, 'reference', ref,
      'fullName', fullname, 'action', action, 'error', problem, 'matches', matches, 'candidateId', c.id));
  END LOOP;
  IF NOT p_commit THEN RETURN jsonb_build_object('rows', report, 'errors', problems, 'review', review); END IF;
  IF problems > 0 THEN RAISE EXCEPTION 'Resolve all flagged rows before importing.'; END IF;

  n := 0;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    item := report->n; n := n + 1; action := item->>'action';
    IF action = 'skip' THEN skipped := skipped + 1; CONTINUE; END IF;
    IF action = 'add' THEN
      target := gen_random_uuid(); secret := upper(encode(gen_random_bytes(6), 'hex'));
      LOOP
        access := 'P-' || upper(encode(gen_random_bytes(4), 'hex'));
        EXIT WHEN NOT EXISTS (SELECT 1 FROM exam_candidates WHERE session_id = p_session_id AND access_code = access);
      END LOOP;
      INSERT INTO exam_candidates(id, session_id, full_name, school, grade, access_code,
        password_plain, password_hash, entry_source, candidate_reference, status, score,
        total_questions, submitted_at, import_batch_id, imported_at, imported_by)
      VALUES(target, p_session_id, trim(r->>'fullName'), trim(r->>'school'), trim(r->>'grade'),
        access, secret, crypt(secret, gen_salt('bf')),
        'paper', upper(trim(r->>'reference')), 'submitted', (r->>'score')::numeric,
        (r->>'maximum')::numeric, now(), batch, now(), p_actor);
      added := added + 1;
      PERFORM _exam_audit(p_session_id, target, p_actor, 'candidate.paper_import',
        jsonb_build_object('batchId', batch, 'reference', upper(trim(r->>'reference')),
          'name', trim(r->>'fullName'), 'score', (r->>'score')::numeric,
          'maximum', (r->>'maximum')::numeric), NULL);
    ELSE
      target := (item->>'candidateId')::uuid;
      SELECT * INTO c FROM exam_candidates WHERE id = target;
      PERFORM _exam_audit(p_session_id, target, p_actor, 'candidate.paper_correction',
        jsonb_build_object('batchId', batch, 'before', jsonb_build_object('name', c.full_name,
        'school', c.school, 'grade', c.grade, 'score', c.score, 'maximum', c.total_questions),
        'after', r), p_reason);
      UPDATE exam_candidates SET full_name = trim(r->>'fullName'), school = trim(r->>'school'),
        grade = trim(r->>'grade'), score = (r->>'score')::numeric,
        total_questions = (r->>'maximum')::numeric, import_batch_id = batch,
        imported_at = now(), imported_by = p_actor WHERE id = target;
      updated := updated + 1;
    END IF;
    -- Inserts do not fire the existing UPDATE-only submission trigger.
    IF s.certificate_mode = 'on_submit' THEN PERFORM _cert_issue(target, p_actor); END IF;
  END LOOP;
  INSERT INTO exam_import_batches(id, session_id, filename, actor_email, reason, added, updated, skipped)
    VALUES(batch, p_session_id, left(p_filename, 255), p_actor, p_reason, added, updated, skipped);
  PERFORM _exam_audit(p_session_id, NULL, p_actor, 'session.import_paper_results',
    jsonb_build_object('batchId', batch, 'filename', left(p_filename, 255),
      'added', added, 'updated', updated, 'skipped', skipped), p_reason);
  RETURN jsonb_build_object('batchId', batch, 'added', added, 'updated', updated, 'skipped', skipped);
END $$;
REVOKE ALL ON FUNCTION admin_import_paper_results(uuid,jsonb,text,text,boolean,text,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_import_paper_results(uuid,jsonb,text,text,boolean,text,boolean,text) TO service_role;

-- Preserve image breakdown for online candidates; paper records have totals only.
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
      'entrySource', c.entry_source,
      'showBreakdown', s.results_published_at IS NOT NULL AND s.results_show_breakdown AND c.entry_source = 'online',
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

COMMIT;
