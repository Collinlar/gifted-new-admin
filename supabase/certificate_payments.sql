-- Certificate payment and approval controls for Exam Mode.
-- Run after certificates.sql and exam_timeout_results.sql.
-- Existing sittings default to `free`, preserving their current behaviour.

ALTER TABLE exam_sessions
  ADD COLUMN IF NOT EXISTS certificate_access_policy text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS certificate_fee_amount numeric(10,2),
  ADD COLUMN IF NOT EXISTS certificate_currency text NOT NULL DEFAULT 'GHS';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_sessions_certificate_access_policy_check'
  ) THEN
    ALTER TABLE exam_sessions ADD CONSTRAINT exam_sessions_certificate_access_policy_check
      CHECK (certificate_access_policy IN ('free', 'included', 'separate', 'manual'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'exam_sessions_certificate_fee_amount_check'
  ) THEN
    ALTER TABLE exam_sessions ADD CONSTRAINT exam_sessions_certificate_fee_amount_check
      CHECK (certificate_fee_amount IS NULL OR certificate_fee_amount >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS exam_certificate_entitlements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  candidate_id      uuid NOT NULL REFERENCES exam_candidates(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'paid', 'waived', 'approved', 'refunded')),
  amount_due        numeric(10,2),
  amount_paid       numeric(10,2),
  currency          text NOT NULL DEFAULT 'GHS',
  payment_reference text,
  paid_at           timestamptz,
  decided_at        timestamptz NOT NULL DEFAULT now(),
  decided_by        text NOT NULL DEFAULT 'unknown',
  note              text,
  source            text NOT NULL DEFAULT 'admin',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS exam_certificate_entitlements_session_status_idx
  ON exam_certificate_entitlements(session_id, status);

ALTER TABLE exam_certificate_entitlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON exam_certificate_entitlements FROM anon, authenticated;

-- One source of truth used by manual, on-publish and on-submit issuance.
CREATE OR REPLACE FUNCTION _cert_access(p_candidate_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c exam_candidates;
  s exam_sessions;
  e exam_certificate_entitlements;
  effective_status text;
  allowed boolean;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'status', 'missing', 'reason', 'Candidate not found');
  END IF;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  SELECT * INTO e FROM exam_certificate_entitlements
   WHERE session_id = s.id AND candidate_id = c.id;

  IF s.certificate_access_policy IN ('free', 'included') THEN
    effective_status := 'not_required';
    allowed := true;
  ELSE
    effective_status := COALESCE(e.status, 'pending');
    allowed := CASE
      WHEN s.certificate_access_policy = 'separate'
        THEN effective_status IN ('paid', 'waived')
      WHEN s.certificate_access_policy = 'manual'
        THEN effective_status IN ('paid', 'waived', 'approved')
      ELSE false
    END;
  END IF;

  RETURN jsonb_build_object(
    'policy', s.certificate_access_policy,
    'status', effective_status,
    'allowed', allowed,
    'amount', s.certificate_fee_amount,
    'currency', s.certificate_currency,
    'paymentReference', e.payment_reference,
    'paidAt', e.paid_at,
    'note', e.note
  );
END;
$$;

-- Supersedes the latest _cert_issue definition. Payment is deliberately a
-- database gate: UI filtering alone would not cover automatic issuance.
CREATE OR REPLACE FUNCTION _cert_issue(p_candidate_id uuid, p_actor text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c        exam_candidates;
  s        exam_sessions;
  access   jsonb;
  pct      numeric;
  chosen   jsonb;
  tpl      certificate_templates;
  new_ser  text;
  new_id   uuid;
  new_key  uuid;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('issued', false, 'reason', 'Candidate not found'); END IF;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;

  IF NOT c.include_in_results THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Excluded from results');
  END IF;
  IF c.status = 'disqualified' THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Attempt was stopped');
  END IF;
  IF c.status <> 'submitted' OR c.submitted_at IS NULL THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Has not submitted');
  END IF;

  access := _cert_access(c.id);
  IF NOT COALESCE((access ->> 'allowed')::boolean, false) THEN
    RETURN jsonb_build_object(
      'issued', false,
      'reason', CASE WHEN access ->> 'policy' = 'manual'
                     THEN 'Certificate has not been approved'
                     ELSE 'Certificate fee has not been confirmed' END,
      'certificateAccess', access
    );
  END IF;

  IF EXISTS (SELECT 1 FROM certificates
              WHERE candidate_id = c.id AND session_id = s.id AND revoked_at IS NULL) THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Already has a certificate');
  END IF;

  pct := CASE WHEN COALESCE(c.total_questions, 0) > 0
              THEN round((COALESCE(c.score, 0)::numeric / c.total_questions) * 100)
              ELSE 0 END;
  SELECT b INTO chosen
    FROM jsonb_array_elements(COALESCE(s.certificate_bands, '[]'::jsonb)) b
   WHERE COALESCE((b ->> 'minPercent')::numeric, 0) <= pct
   ORDER BY COALESCE((b ->> 'minPercent')::numeric, 0) DESC LIMIT 1;
  IF chosen IS NULL THEN
    RETURN jsonb_build_object('issued', false, 'reason', 'Score is below every band');
  END IF;
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
      'candidate_name', c.full_name, 'school', COALESCE(c.school, ''),
      'grade', COALESCE(c.grade, ''), 'exam_title', s.title,
      'score', COALESCE(c.score, 0), 'total', COALESCE(c.total_questions, 0),
      'percentage', pct, 'grade_band', chosen ->> 'band',
      'date_issued', to_char(now(), 'DD Mon YYYY'), 'serial', new_ser
    ), p_actor
  ) RETURNING id INTO new_id;

  RETURN jsonb_build_object('issued', true, 'id', new_id, 'serial', new_ser,
    'downloadKey', new_key, 'band', chosen ->> 'band');
END;
$$;

CREATE OR REPLACE FUNCTION admin_set_certificate_entitlements(
  p_session_id uuid,
  p_candidate_ids uuid[],
  p_status text,
  p_actor text DEFAULT 'unknown',
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_amount_paid numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  s exam_sessions;
  target uuid;
  changed integer := 0;
  issued integer := 0;
  res jsonb;
BEGIN
  IF p_status NOT IN ('pending', 'paid', 'waived', 'approved', 'refunded') THEN
    RAISE EXCEPTION 'Choose a valid certificate payment status.';
  END IF;
  IF COALESCE(cardinality(p_candidate_ids), 0) = 0 OR cardinality(p_candidate_ids) > 1000 THEN
    RAISE EXCEPTION 'Select between 1 and 1000 candidates.';
  END IF;
  SELECT * INTO s FROM exam_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That exam sitting no longer exists.'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_candidate_ids) AS selected(candidate_id)
     WHERE NOT EXISTS (SELECT 1 FROM exam_candidates c
                       WHERE c.id = selected.candidate_id AND c.session_id = p_session_id)
  ) THEN
    RAISE EXCEPTION 'A selected candidate is not in this exam sitting.';
  END IF;

  FOREACH target IN ARRAY p_candidate_ids LOOP
    INSERT INTO exam_certificate_entitlements (
      session_id, candidate_id, status, amount_due, amount_paid, currency,
      payment_reference, paid_at, decided_at, decided_by, note, updated_at
    ) VALUES (
      p_session_id, target, p_status, s.certificate_fee_amount,
      CASE WHEN p_status = 'paid' THEN COALESCE(p_amount_paid, s.certificate_fee_amount) END,
      s.certificate_currency, NULLIF(trim(COALESCE(p_reference, '')), ''),
      CASE WHEN p_status = 'paid' THEN now() END, now(), p_actor,
      NULLIF(trim(COALESCE(p_note, '')), ''), now()
    )
    ON CONFLICT (session_id, candidate_id) DO UPDATE SET
      status = EXCLUDED.status,
      amount_due = EXCLUDED.amount_due,
      amount_paid = CASE WHEN EXCLUDED.status = 'paid' THEN EXCLUDED.amount_paid
                         ELSE exam_certificate_entitlements.amount_paid END,
      currency = EXCLUDED.currency,
      payment_reference = COALESCE(EXCLUDED.payment_reference, exam_certificate_entitlements.payment_reference),
      paid_at = CASE WHEN EXCLUDED.status = 'paid' THEN COALESCE(exam_certificate_entitlements.paid_at, now())
                     ELSE exam_certificate_entitlements.paid_at END,
      decided_at = now(), decided_by = p_actor,
      note = COALESCE(EXCLUDED.note, exam_certificate_entitlements.note), updated_at = now();
    changed := changed + 1;

    IF p_status IN ('paid', 'waived', 'approved')
       AND ((s.certificate_mode = 'on_submit' AND EXISTS (
              SELECT 1 FROM exam_candidates WHERE id = target AND status = 'submitted'))
         OR (s.certificate_mode = 'on_publish' AND s.results_published_at IS NOT NULL)) THEN
      res := _cert_issue(target, p_actor);
      IF COALESCE((res ->> 'issued')::boolean, false) THEN issued := issued + 1; END IF;
    END IF;
  END LOOP;

  PERFORM _exam_audit(p_session_id, NULL, p_actor, 'certificate.entitlement',
    jsonb_build_object('candidateIds', p_candidate_ids, 'status', p_status,
      'changed', changed, 'issued', issued, 'reference', p_reference), p_note);
  RETURN jsonb_build_object('changed', changed, 'issued', issued);
END;
$$;

-- Keep certificate availability visible in My Exams without exposing the
-- entitlement table to browser queries.
CREATE OR REPLACE FUNCTION _exam_account_result(p_candidate_id uuid, p_breakdown boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp AS $$
DECLARE
  c exam_candidates; s exam_sessions; cert certificates;
  released boolean; certificate_json jsonb := NULL; breakdown jsonb := '[]'; access_json jsonb;
  qs jsonb; q jsonb; i integer;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM _exam_finish(c.id);
  SELECT * INTO c FROM exam_candidates WHERE id=p_candidate_id;
  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;
  access_json := _cert_access(c.id);
  released := s.results_published_at IS NOT NULL AND c.status = 'submitted' AND c.include_in_results;
  IF c.status = 'submitted' AND c.include_in_results THEN
    SELECT * INTO cert FROM certificates WHERE candidate_id = c.id AND session_id = s.id
      AND revoked_at IS NULL LIMIT 1;
    IF FOUND THEN certificate_json := jsonb_build_object(
      'serial', cert.serial, 'downloadKey', cert.download_key, 'band', cert.band); END IF;
  END IF;
  IF p_breakdown AND released AND s.results_show_breakdown AND c.entry_source = 'online' THEN
    SELECT questions INTO qs FROM exams WHERE id = s.exam_id;
    FOREACH i IN ARRAY COALESCE(c.question_order, ARRAY[]::integer[]) LOOP
      q := qs->i;
      IF q IS NOT NULL THEN
        breakdown := breakdown || jsonb_build_array(jsonb_build_object(
          'idx', i, 'question', q->>'question', 'image', q->>'image', 'imageTitle', q->>'imageTitle',
          'media', COALESCE(q->'media','[]'::jsonb), 'answerMedia', COALESCE(q->'answerMedia','[]'::jsonb),
          'answerValues', COALESCE(q->'answerValues',q->'answers','[]'::jsonb),
          'correctAnswerIndex', q->'correctAnswerIndex', 'options', COALESCE(q->'answers','[]'::jsonb),
          'yourAnswer', c.answers->>i::text, 'correctAnswer', q->>'correctAnswer',
          'explanation', q->>'explanation', 'correct', (c.answers->>i::text) IS NOT NULL
            AND (c.answers->>i::text) = (q->>'correctAnswer')));
      END IF;
    END LOOP;
  END IF;
  RETURN jsonb_build_object('candidateId', c.id, 'sessionCode', s.session_code,
    'candidateName', c.full_name, 'school', c.school, 'grade', c.grade,
    'examTitle', s.title, 'status', c.status, 'entrySource', c.entry_source,
    'timedOut', c.timed_out, 'resultIncluded', c.include_in_results,
    'resultsOut', released, 'score', CASE WHEN released THEN c.score END,
    'total', CASE WHEN released THEN c.total_questions END, 'submittedAt', c.submitted_at,
    'linkedAt', c.account_linked_at, 'certificate', certificate_json,
    'certificateAccess', access_json, 'breakdown', breakdown,
    'showBreakdown', p_breakdown AND released AND s.results_show_breakdown AND c.entry_source = 'online');
END $$;

REVOKE ALL ON FUNCTION _cert_access(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_set_certificate_entitlements(uuid,uuid[],text,text,text,text,numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION _cert_access(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION admin_set_certificate_entitlements(uuid,uuid[],text,text,text,text,numeric)
  TO service_role;

