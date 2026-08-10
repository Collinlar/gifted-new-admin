-- ═══════════════════════════════════════════════════════════════════════════
-- CERTIFICATES
--
-- Run after exam_mode_v2.sql. Idempotent and safe over a live install.
--
-- Three things kept deliberately separate:
--   a template   is a design, reusable across many sittings
--   a band rule  belongs to one sitting and decides who gets which template
--   a certificate is an issued record for one candidate, with frozen data
--
-- Two identifiers per certificate, and the distinction matters:
--   serial       public and sequential, printed and shown on the verify page
--   download_key random and secret, the only way to fetch the PDF
-- Serials are guessable by design so they can be quoted and checked. If the PDF
-- hung off the serial, guessing one would hand over someone else's document.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Templates ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS certificate_templates (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text        NOT NULL,
  background_url text,                               -- uploaded artwork
  theme          text        NOT NULL DEFAULT 'plain', -- used when no upload
  page_size      text        NOT NULL DEFAULT 'A4',
  orientation    text        NOT NULL DEFAULT 'landscape',
  -- [{ id, type: text|image|qr, ... , x, y }] with x/y as percentages of the
  -- page so a template survives a change of background resolution.
  fields         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- ── Issuance rules live on the sitting ─────────────────────────────────────

ALTER TABLE exam_sessions
  -- none | manual | on_publish | on_submit
  ADD COLUMN IF NOT EXISTS certificate_mode  text  NOT NULL DEFAULT 'none',
  -- [{ minPercent, templateId, band }], highest match wins
  ADD COLUMN IF NOT EXISTS certificate_bands jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ── Issued certificates ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS certificates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  serial          text        NOT NULL UNIQUE,
  download_key    uuid        NOT NULL DEFAULT gen_random_uuid(),
  session_id      uuid        NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
  candidate_id    uuid        NOT NULL REFERENCES exam_candidates(id) ON DELETE CASCADE,
  template_id     uuid        NOT NULL REFERENCES certificate_templates(id),
  band            text,
  -- Every value printed on the document, frozen at issue. A later score
  -- correction must not silently rewrite a certificate already downloaded.
  snapshot        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  issued_by       text        NOT NULL DEFAULT 'system',
  revoked_at      timestamptz,
  revoked_by      text,
  revoke_reason   text,
  replaces_serial text
);

-- One live certificate per candidate per sitting. Revoked ones stay for the
-- record and do not block a reissue.
CREATE UNIQUE INDEX IF NOT EXISTS certificates_one_live_per_candidate
  ON certificates(session_id, candidate_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS certificates_session_idx  ON certificates(session_id);
CREATE INDEX IF NOT EXISTS certificates_download_idx ON certificates(download_key);

ALTER TABLE certificate_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE certificates          ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON certificate_templates FROM anon, authenticated;
REVOKE ALL ON certificates          FROM anon, authenticated;

-- ── Serial allocation ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _cert_next_serial(p_session_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  prefix text;
  n      integer;
  cand   text;
BEGIN
  SELECT upper(left(regexp_replace(session_code, '[^A-Za-z0-9]', '', 'g'), 10))
    INTO prefix FROM exam_sessions WHERE id = p_session_id;
  prefix := COALESCE(NULLIF(prefix, ''), 'CERT');

  SELECT count(*) INTO n FROM certificates WHERE session_id = p_session_id;

  LOOP
    n := n + 1;
    cand := prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM certificates WHERE serial = cand);
  END LOOP;

  RETURN cand;
END;
$$;

-- ── The single issuance path ───────────────────────────────────────────────
-- Manual, on-publish and on-submit all funnel through here so the eligibility
-- rules cannot drift apart between them.

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

-- ── Admin: bulk issue ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_issue_certificates(
  p_session_id   uuid,
  p_candidate_ids uuid[],
  p_actor        text DEFAULT 'unknown',
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  target  uuid;
  res     jsonb;
  issued  integer := 0;
  skipped jsonb   := '[]'::jsonb;
  ids     uuid[];
BEGIN
  -- No explicit list means everyone in the sitting
  IF p_candidate_ids IS NULL OR array_length(p_candidate_ids, 1) IS NULL THEN
    SELECT array_agg(id) INTO ids FROM exam_candidates WHERE session_id = p_session_id;
  ELSE
    ids := p_candidate_ids;
  END IF;

  FOREACH target IN ARRAY COALESCE(ids, ARRAY[]::uuid[]) LOOP
    res := _cert_issue(target, p_actor);
    IF (res ->> 'issued')::boolean THEN
      issued := issued + 1;
    ELSE
      skipped := skipped || jsonb_build_array(jsonb_build_object(
        'candidateId', target,
        'name', (SELECT full_name FROM exam_candidates WHERE id = target),
        'reason', res ->> 'reason'
      ));
    END IF;
  END LOOP;

  PERFORM _exam_audit(
    p_session_id, NULL, p_actor, 'certificate.issue',
    jsonb_build_object('issued', issued, 'skipped', jsonb_array_length(skipped)),
    p_reason
  );

  RETURN jsonb_build_object('issued', issued, 'skipped', skipped);
END;
$$;

-- ── Admin: revoke and reissue ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION admin_revoke_certificate(
  p_certificate_id uuid,
  p_actor  text DEFAULT 'unknown',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE cert certificates;
BEGIN
  SELECT * INTO cert FROM certificates WHERE id = p_certificate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificate not found.'; END IF;
  IF cert.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'alreadyRevoked', true);
  END IF;

  UPDATE certificates
     SET revoked_at = now(), revoked_by = p_actor, revoke_reason = p_reason
   WHERE id = cert.id;

  PERFORM _exam_audit(
    cert.session_id, cert.candidate_id, p_actor, 'certificate.revoke',
    jsonb_build_object('serial', cert.serial), p_reason
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Reissue is revoke plus issue, linked so a stale downloaded copy fails
-- verification rather than passing quietly.
CREATE OR REPLACE FUNCTION admin_reissue_certificate(
  p_certificate_id uuid,
  p_actor  text DEFAULT 'unknown',
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  cert certificates;
  res  jsonb;
BEGIN
  SELECT * INTO cert FROM certificates WHERE id = p_certificate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificate not found.'; END IF;

  IF cert.revoked_at IS NULL THEN
    UPDATE certificates
       SET revoked_at = now(), revoked_by = p_actor,
           revoke_reason = COALESCE(p_reason, 'Replaced by a reissue')
     WHERE id = cert.id;
  END IF;

  res := _cert_issue(cert.candidate_id, p_actor);

  IF (res ->> 'issued')::boolean THEN
    UPDATE certificates SET replaces_serial = cert.serial
     WHERE id = (res ->> 'id')::uuid;
  END IF;

  PERFORM _exam_audit(
    cert.session_id, cert.candidate_id, p_actor, 'certificate.reissue',
    jsonb_build_object('was', cert.serial, 'now', res ->> 'serial'), p_reason
  );

  RETURN res;
END;
$$;

-- ── Automatic issuance ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _cert_auto_for_session(p_session_id uuid, p_actor text)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  target uuid;
  res    jsonb;
  n      integer := 0;
BEGIN
  FOR target IN
    SELECT id FROM exam_candidates WHERE session_id = p_session_id AND status = 'submitted'
  LOOP
    res := _cert_issue(target, p_actor);
    IF (res ->> 'issued')::boolean THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- Fires when a candidate submits, if the sitting is set to on_submit
CREATE OR REPLACE FUNCTION _cert_on_submit(p_candidate_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE mode text;
BEGIN
  SELECT s.certificate_mode INTO mode
    FROM exam_candidates c JOIN exam_sessions s ON s.id = c.session_id
   WHERE c.id = p_candidate_id;

  IF mode = 'on_submit' THEN
    PERFORM _cert_issue(p_candidate_id, 'system (on submission)');
  END IF;
END;
$$;

-- ── Triggers that drive automatic issuance ─────────────────────────────────
--
-- Hooked with triggers rather than by editing exam_submit and
-- admin_session_action, so certificate logic stays in this file and the exam
-- functions keep one job each.
--
-- Both swallow their own errors. A certificate is the least important thing
-- happening at either of these moments: a broken template must never roll back
-- a candidate's submission or stop results being published.

CREATE OR REPLACE FUNCTION _cert_trg_submitted()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.status = 'submitted' AND OLD.status IS DISTINCT FROM 'submitted' THEN
    BEGIN
      PERFORM _cert_on_submit(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO exam_events(candidate_id, type, meta)
        VALUES (NEW.id, 'certificate_failed', jsonb_build_object('error', SQLERRM));
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cert_on_submitted ON exam_candidates;
CREATE TRIGGER cert_on_submitted
  AFTER UPDATE ON exam_candidates
  FOR EACH ROW EXECUTE FUNCTION _cert_trg_submitted();

CREATE OR REPLACE FUNCTION _cert_trg_published()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF NEW.results_published_at IS NOT NULL
     AND OLD.results_published_at IS NULL
     AND NEW.certificate_mode = 'on_publish' THEN
    BEGIN
      PERFORM _cert_auto_for_session(NEW.id, COALESCE(NEW.results_published_by, 'system'));
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cert_on_published ON exam_sessions;
CREATE TRIGGER cert_on_published
  AFTER UPDATE ON exam_sessions
  FOR EACH ROW EXECUTE FUNCTION _cert_trg_published();

-- ── Public verification ────────────────────────────────────────────────────
-- Deliberately narrow. Serials are quotable and therefore guessable, so this
-- returns only what a certificate already shows on its face: no school, no
-- contact details, no answer level information.

CREATE OR REPLACE FUNCTION verify_certificate(p_serial text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE cert certificates;
BEGIN
  SELECT * INTO cert FROM certificates WHERE upper(serial) = upper(trim(p_serial));

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false);
  END IF;

  RETURN jsonb_build_object(
    'found',      true,
    'serial',     cert.serial,
    'name',       cert.snapshot ->> 'candidate_name',
    'exam',       cert.snapshot ->> 'exam_title',
    'band',       cert.band,
    'issuedAt',   cert.issued_at,
    'revoked',    cert.revoked_at IS NOT NULL,
    'revokedAt',  cert.revoked_at
  );
END;
$$;

-- ── Paper delivery, extended to carry image captions ───────────────────────
--
-- SUPERSEDES the exam_get_paper in exam_mode_v2.sql. The paper is built field
-- by field so the answer key cannot leak, which also means a newly added field
-- has to be named here or it silently never reaches the candidate.

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

-- ── Login, extended to hand back a certificate ─────────────────────────────
--
-- THIS SUPERSEDES the exam_candidate_login in exam_mode_v2.sql. Edit this copy,
-- not that one, or your change will be overwritten the next time these
-- migrations are replayed in order.
--
-- Two behaviours worth knowing. A certificate is treated as a separate artifact
-- from results: if one has been issued, the candidate can collect it even when
-- results themselves are still unpublished. That matters for the on_submit
-- mode, where the whole point is immediate delivery.

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

-- ── Grants ─────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION verify_certificate(text)                     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_candidate_login(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION exam_get_paper(uuid)                         TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION _cert_next_serial(uuid)                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _cert_issue(uuid, text)                              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _cert_auto_for_session(uuid, text)                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION _cert_on_submit(uuid)                                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_issue_certificates(uuid, uuid[], text, text)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_revoke_certificate(uuid, text, text)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION admin_reissue_certificate(uuid, text, text)          FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION admin_issue_certificates(uuid, uuid[], text, text)    TO service_role;
GRANT EXECUTE ON FUNCTION admin_revoke_certificate(uuid, text, text)            TO service_role;
GRANT EXECUTE ON FUNCTION admin_reissue_certificate(uuid, text, text)           TO service_role;
GRANT EXECUTE ON FUNCTION _cert_auto_for_session(uuid, text)                    TO service_role;
