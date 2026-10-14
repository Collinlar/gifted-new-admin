-- ═══════════════════════════════════════════════════════════════════════════
-- EXAM MODE — take a candidate off a sitting, on the record
--
-- Run once. Adds one function. No schema change, safe to run twice.
--
-- WHY THIS IS NOT JUST A DELETE
--
-- Everything that points at a candidate cascades:
--
--   certificates.candidate_id     ON DELETE CASCADE
--   exam_answer_log.candidate_id  ON DELETE CASCADE
--   exam_events.candidate_id      ON DELETE CASCADE
--
-- So removing a row quietly takes their answer log, their invigilation record
-- and any certificate with it. There is already a delete-candidate endpoint
-- doing exactly that, unaudited and wired to nothing; this replaces it.
--
-- Two deliberate choices:
--
-- 1. A live certificate blocks the removal. A certificate carries a serial a
--    school can check, and deleting the row behind it turns that check into a
--    dead end for someone holding a printed copy. Withdraw it first, which is
--    its own audited action, then remove.
--
-- 2. Everything else is allowed, but the whole candidate row is written into
--    the audit first. exam_audit_log.candidate_id carries no foreign key, on
--    purpose, so that entry outlives the row it describes and the register
--    can be rebuilt from it afterwards.
--
-- The password columns are stripped on the way in. They are an access code
-- for one sitting rather than an account password, but an audit log is read
-- by more people than the candidates table and it does not need them.
--
-- Of 1,274 candidates today, 962 are pending and have never started, which is
-- the case this exists for: somebody sitting in the wrong room.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_remove_candidate(
  p_candidate_id uuid,
  p_actor        text DEFAULT 'unknown',
  p_reason       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  c         exam_candidates;
  s         exam_sessions;
  n_live    integer;
  n_certs   integer;
  n_answers integer;
  n_events  integer;
BEGIN
  SELECT * INTO c FROM exam_candidates WHERE id = p_candidate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That candidate is not on this sitting any more.';
  END IF;

  SELECT * INTO s FROM exam_sessions WHERE id = c.session_id;

  SELECT count(*) INTO n_live
    FROM certificates WHERE candidate_id = c.id AND revoked_at IS NULL;

  IF n_live > 0 THEN
    RAISE EXCEPTION 'This candidate holds a certificate that can be checked by serial. Withdraw the certificate first, then remove them.';
  END IF;

  SELECT count(*) INTO n_certs   FROM certificates    WHERE candidate_id = c.id;
  SELECT count(*) INTO n_answers FROM exam_answer_log WHERE candidate_id = c.id;
  SELECT count(*) INTO n_events  FROM exam_events     WHERE candidate_id = c.id;

  PERFORM _exam_audit(
    c.session_id, c.id, p_actor, 'candidate.remove',
    jsonb_build_object(
      'candidate',            to_jsonb(c) - 'password_hash' - 'password_plain',
      'sessionTitle',         s.title,
      'sessionCode',          s.session_code,
      'answerLogRowsRemoved', n_answers,
      'eventRowsRemoved',     n_events,
      'withdrawnCertificatesRemoved', n_certs
    ),
    p_reason
  );

  DELETE FROM exam_candidates WHERE id = c.id;

  RETURN jsonb_build_object(
    'removed',       true,
    'fullName',      c.full_name,
    'accessCode',    c.access_code,
    'status',        c.status,
    'answerLogRows', n_answers,
    'eventRows',     n_events
  );
END;
$$;

GRANT EXECUTE ON FUNCTION admin_remove_candidate(uuid, text, text) TO service_role;

-- Verify:
--   a pending candidate removes, and the audit carries the row
--     SELECT action, detail -> 'candidate' ->> 'full_name', reason
--       FROM exam_audit_log WHERE action = 'candidate.remove' ORDER BY id DESC LIMIT 1;
--   a candidate holding a live certificate is refused
--   the chain still verifies
--     SELECT admin_verify_audit_chain();
