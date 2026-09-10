-- ═══════════════════════════════════════════════════════════════════════════
-- REGISTRATIONS v6 — lookup_account_status, corrected against the real data
--
-- Run after registrations_v5.sql. Idempotent, safe to run twice.
-- Replaces the function only. No schema change, nothing to undo.
--
-- Two things v5 got wrong, both found by running it against the live table
-- rather than by reading it.
--
-- 1. Somebody with a working sign-in was told to claim their account
--    The backfill left people with two rows: the legacy one and the row
--    created when they signed up. v5 ordered unclaimed-legacy first on the
--    grounds that it was "the more useful answer", which is exactly backwards
--    when the person can already sign in. Collins' own account does this, and
--    so do four others by email and two by phone. Sending them to the claim
--    flow is worse than saying nothing: claiming inserts a second users row
--    and marks the first taken.
--
--    Now a live account always wins. Claiming is only ever offered to someone
--    who has no way in yet.
--
-- 2. School addresses were treated as one person
--    5,148 rows have no email at all and 5,327 have no usable phone, and the
--    addresses that are there are heavily shared: the most common email sits
--    on 78 different students, almost certainly a teacher who registered a
--    whole class. Asked about that address, v5 answered "we have a record of
--    you, claim your account". Which of the 78?
--
--    When an identifier points at more than a couple of unclaimed rows there
--    is no single account to offer, so the honest answer is to say nothing
--    and let them register. The claim flow keys on phone number anyway, so a
--    person whose own number is on file still gets the offer through that.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lookup_account_status(
  p_email text DEFAULT NULL,
  p_phone text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  -- Above this many unclaimed rows behind one address, it is an institution
  -- rather than a person. Two allows for someone genuinely duplicated by the
  -- backfill; a class of thirty is not that.
  ambiguous_above constant integer := 2;

  mail   text := lower(NULLIF(trim(COALESCE(p_email, '')), ''));
  phone  text := NULLIF(regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g'), '');
  local9 text;
  n_live      integer := 0;
  n_claimable integer := 0;
BEGIN
  IF mail IS NULL AND phone IS NULL THEN
    RETURN jsonb_build_object('known', false);
  END IF;

  -- Ghana numbers sit in the table as 024..., 23324... and +23324... depending
  -- on which import carried them. The last nine digits are the one form they
  -- all share. Anything shorter than that is not a number worth matching on.
  IF phone IS NOT NULL AND length(phone) >= 9 THEN
    local9 := right(phone, 9);
  END IF;

  IF mail IS NULL AND local9 IS NULL THEN
    RETURN jsonb_build_object('known', false);
  END IF;

  SELECT
    count(*) FILTER (
      WHERE mongo_id IS NULL OR claimed_by IS NOT NULL OR claimed IS TRUE
    ),
    count(*) FILTER (
      WHERE mongo_id IS NOT NULL AND claimed_by IS NULL AND claimed IS DISTINCT FROM true
    )
    INTO n_live, n_claimable
    FROM users
   WHERE (mail IS NOT NULL AND lower(email) = mail)
      OR (local9 IS NOT NULL
          AND right(regexp_replace(COALESCE(mobile_number, ''), '\D', '', 'g'), 9) = local9);

  -- Somebody who can already sign in is told to sign in, whatever else is
  -- lying around under the same address.
  IF n_live > 0 THEN
    RETURN jsonb_build_object('known', true, 'claimable', false);
  END IF;

  IF n_claimable BETWEEN 1 AND ambiguous_above THEN
    RETURN jsonb_build_object('known', true, 'claimable', true);
  END IF;

  -- Either nothing matched, or so much matched that there is no one account
  -- to point at. Both mean the form says nothing and they carry on.
  RETURN jsonb_build_object('known', false);
END;
$fn$;

GRANT EXECUTE ON FUNCTION lookup_account_status(text, text) TO anon, authenticated;

-- Verify, using the cases that caught v5:
--   -- an account that can already sign in: expect claimable false
--   SELECT lookup_account_status('kofcollkcl100@gmail.com', NULL);
--   -- an address shared by a whole class: expect known false
--   SELECT lookup_account_status(
--     (SELECT lower(email) FROM users WHERE email IS NOT NULL
--       GROUP BY lower(email) ORDER BY count(*) DESC LIMIT 1), NULL);
--   -- somebody who has never been here: expect known false
--   SELECT lookup_account_status('nobody-here@example.invalid', NULL);
