-- ═══════════════════════════════════════════════════════════════════════════
-- REGISTRATIONS v5 — recognising returning people, and admin control of the
-- screen they see after registering
--
-- Run after registrations_v4.sql. Idempotent, safe to run twice.
--
-- Two unrelated things, one migration, because both are small.
--
-- 1. Account recognition
--    Most of the people filling in these forms already exist: they were
--    brought across in the backfill and have never claimed their account.
--    They have no way of knowing that, so they register as guests, and the
--    prefill that would have made every later form short never applies to
--    them. lookup_account_status lets the form say "we already know this
--    address" at the moment they type it, and offer the two ways in.
--
-- 2. What happens after they submit
--    Card payment is not switched on yet, so the confirmation screen was
--    telling everyone "we will send you a link to pay", which is not true.
--    The instructions and the payment link now come from the form, so the
--    team can put the real momo details and the built.ac link there.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── What the confirmation screen says ──────────────────────────────────────

ALTER TABLE registration_forms
  -- Replaces the hardcoded "we will send you a link to pay". Empty means the
  -- screen falls back to a neutral line that promises nothing.
  ADD COLUMN IF NOT EXISTS payment_note text,
  -- Rendered as a button rather than a bare URL in a paragraph, which is how
  -- the built.ac link currently reaches people
  ADD COLUMN IF NOT EXISTS payment_link_url text,
  ADD COLUMN IF NOT EXISTS payment_link_label text,
  -- Shown under the confirmation message for anything that is not about
  -- money: what to bring, when results are announced, who to contact
  ADD COLUMN IF NOT EXISTS post_submit_note text;

-- ── Do we already know this person ─────────────────────────────────────────
--
-- Deliberately coarse. It answers only "is this address or number already on
-- the platform, and does it still need claiming". No name, no id, nothing
-- that would let someone build a list out of it.
--
-- It is an existence check on an address someone typed, so it does tell a
-- caller whether a given email is registered here. That is the same thing a
-- sign-in attempt tells them, and the alternative is leaving every backfilled
-- family registering as strangers forever.

CREATE OR REPLACE FUNCTION lookup_account_status(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  mail   text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  phone  text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), '');
  local9 text;
  u      record;
BEGIN
  IF mail IS NULL AND phone IS NULL THEN
    RETURN jsonb_build_object('known', false);
  END IF;

  -- Ghana numbers are stored as 024..., 23324... and +23324... depending on
  -- which import they came in through. Comparing the last nine digits is the
  -- one form all of those share.
  IF phone IS NOT NULL AND length(phone) >= 9 THEN
    local9 := right(phone, 9);
  END IF;

  SELECT mongo_id, claimed, claimed_by
    INTO u
    FROM users
   WHERE (mail IS NOT NULL AND lower(email) = mail)
      OR (local9 IS NOT NULL
          AND right(regexp_replace(COALESCE(mobile_number, ''), '\D', '', 'g'), 9) = local9)
   ORDER BY
     -- An unclaimed legacy row is the more useful answer of the two, because
     -- it is the one with something to do about it
     (mongo_id IS NOT NULL AND claimed_by IS NULL AND claimed IS DISTINCT FROM true) DESC,
     created_at ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('known', false);
  END IF;

  RETURN jsonb_build_object(
    'known', true,
    'claimable', u.mongo_id IS NOT NULL
                 AND u.claimed_by IS NULL
                 AND u.claimed IS DISTINCT FROM true
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION lookup_account_status(text, text) TO anon, authenticated;

-- Verify:
--   SELECT lookup_account_status('kofcollkcl100@gmail.com', NULL);
--   SELECT lookup_account_status(NULL, '0242101281');
--   SELECT lookup_account_status('nobody@example.com', NULL);
