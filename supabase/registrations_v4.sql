-- ═══════════════════════════════════════════════════════════════════════════
-- REGISTRATIONS v4 — guests can register
--
-- Run after registrations_v3.sql. Idempotent, safe to run twice.
--
-- What was wrong
-- --------------
-- get_registration_prefill and submit_registration both opened with
--   IF auth.uid() IS NULL THEN RETURN 'Sign in to register.'
-- so opening /register/GH-STEM signed out returned that error before the form
-- was ever fetched, and the page showed it instead of the questions. The
-- point of the account was that returning students answer fewer questions,
-- not that a stranger cannot enter at all.
--
-- What a guest now gets
-- ---------------------
-- The full form, with nothing prefilled because we know nothing about them,
-- and a reference plus a private token on submit. The token is what lets them
-- come back to pay or check status without an account, and it is the only
-- thing that will: there is no anon read policy on registrations, so a guest
-- who guesses a reference still sees nothing.
--
-- And if they sign up later
-- -------------------------
-- claim_guest_registrations attaches anything registered with their email to
-- the new account, so the second form is short for them too. Without it,
-- registering as a guest first would permanently opt someone out of the
-- prefill that makes this whole thing worth using.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Columns ────────────────────────────────────────────────────────────────

ALTER TABLE registrations ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS guest_email text,
  ADD COLUMN IF NOT EXISTS guest_name  text,
  ADD COLUMN IF NOT EXISTS guest_phone text,
  -- Returned once, on submit. Held by the guest's browser, never listed.
  ADD COLUMN IF NOT EXISTS claim_token text,
  ADD COLUMN IF NOT EXISTS claimed_at  timestamptz;

-- One guest entry per form per email address. Partial, because signed-in rows
-- have a null guest_email and the existing UNIQUE (form_id, user_id) already
-- covers them.
CREATE UNIQUE INDEX IF NOT EXISTS registrations_guest_unique
  ON registrations (form_id, lower(guest_email))
  WHERE user_id IS NULL AND guest_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS registrations_guest_email_idx
  ON registrations (lower(guest_email)) WHERE user_id IS NULL;

-- ── Reading identity out of the answers ────────────────────────────────────
--
-- A form's email question is whichever field is sourced from profile.email.
-- Falling back to a key named "email" covers forms built before sources
-- existed. Returns null when the form does not ask, which is allowed: the
-- token still works, we just cannot dedupe or contact them by address.

CREATE OR REPLACE FUNCTION _reg_answer_for(
  p_fields jsonb,
  p_answers jsonb,
  p_source text,
  p_fallback_keys text[]
)
RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $fn$
DECLARE
  fld jsonb;
  k   text;
BEGIN
  FOR fld IN SELECT * FROM jsonb_array_elements(COALESCE(p_fields, '[]'::jsonb)) LOOP
    IF (fld ->> 'source') = p_source THEN
      k := fld ->> 'key';
      IF k IS NOT NULL AND NULLIF(trim(COALESCE(p_answers ->> k, '')), '') IS NOT NULL THEN
        RETURN trim(p_answers ->> k);
      END IF;
    END IF;
  END LOOP;

  FOREACH k IN ARRAY p_fallback_keys LOOP
    IF NULLIF(trim(COALESCE(p_answers ->> k, '')), '') IS NOT NULL THEN
      RETURN trim(p_answers ->> k);
    END IF;
  END LOOP;

  RETURN NULL;
END;
$fn$;

-- ── Prefill, for anyone ────────────────────────────────────────────────────
--
-- A guest gets the same shape with nothing in it, so the page needs no branch
-- and every field falls through to its own empty default.

CREATE OR REPLACE FUNCTION get_registration_prefill(p_form_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  uid uuid := auth.uid();
  prof record;
  mem jsonb;
  existing registrations;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object(
      'profile', '{}'::jsonb,
      'memory',  '{}'::jsonb,
      'existing', NULL,
      'guest', true
    );
  END IF;

  SELECT first_name, last_name, email, mobile_number, date_of_birth, gender,
         country, grade, school_name, educational_level, category
    INTO prof FROM users WHERE id = uid;

  SELECT COALESCE(jsonb_object_agg(field_key, value), '{}'::jsonb)
    INTO mem FROM user_answer_memory WHERE user_id = uid;

  SELECT * INTO existing FROM registrations WHERE form_id = p_form_id AND user_id = uid;

  RETURN jsonb_build_object(
    'profile', jsonb_build_object(
      'first_name', prof.first_name, 'last_name', prof.last_name,
      'email', prof.email, 'mobile_number', prof.mobile_number,
      'date_of_birth', prof.date_of_birth, 'gender', prof.gender,
      'country', prof.country, 'grade', prof.grade,
      'school_name', prof.school_name, 'educational_level', prof.educational_level,
      'category', prof.category
    ),
    'memory', mem,
    'existing', CASE WHEN existing.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', existing.id, 'reference', existing.reference, 'status', existing.status,
      'answers', existing.answers, 'paymentStatus', existing.payment_status
    ) END,
    'guest', false
  );
END;
$fn$;

-- ── Submitting, for anyone ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION submit_registration(
  p_form_id uuid,
  p_answers jsonb,
  p_beneficiary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  uid        uuid := auth.uid();
  f          registration_forms;
  existing   registrations;
  taken      integer;
  new_ref    text;
  new_status text;
  pay_status text;
  fld        jsonb;
  k          text;
  rid        uuid;
  g_email    text;
  g_name     text;
  g_phone    text;
  g_token    text;
BEGIN
  SELECT * INTO f FROM registration_forms WHERE id = p_form_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'That registration form no longer exists.');
  END IF;
  IF f.status <> 'open' THEN
    RETURN jsonb_build_object('error', 'Registration for this programme is not open.');
  END IF;
  IF f.opens_at IS NOT NULL AND now() < f.opens_at THEN
    RETURN jsonb_build_object('error',
      'Registration opens on ' || to_char(f.opens_at, 'DD Mon YYYY') || '.');
  END IF;
  IF f.closes_at IS NOT NULL AND now() > f.closes_at THEN
    RETURN jsonb_build_object('error', 'Registration for this programme has closed.');
  END IF;

  IF uid IS NOT NULL THEN
    SELECT * INTO existing FROM registrations WHERE form_id = p_form_id AND user_id = uid;
  ELSE
    g_email := lower(_reg_answer_for(f.fields, p_answers, 'profile.email',
                                     ARRAY['email', 'email_address']));
    g_phone := _reg_answer_for(f.fields, p_answers, 'profile.mobile_number',
                               ARRAY['mobile_number', 'phone', 'phone_number']);
    g_name  := trim(concat_ws(' ',
      _reg_answer_for(f.fields, p_answers, 'profile.first_name', ARRAY['first_name']),
      _reg_answer_for(f.fields, p_answers, 'profile.last_name',  ARRAY['last_name'])));
    g_name  := NULLIF(g_name, '');

    IF g_email IS NOT NULL THEN
      SELECT * INTO existing FROM registrations
       WHERE form_id = p_form_id AND user_id IS NULL AND lower(guest_email) = g_email;
    END IF;
  END IF;

  IF existing.id IS NOT NULL AND existing.status NOT IN ('draft', 'submitted') THEN
    RETURN jsonb_build_object('error',
      'Your registration has already been reviewed and cannot be changed.');
  END IF;

  -- Capacity counts confirmed places only, so waitlisted and rejected entries
  -- do not hold a seat.
  new_status := 'submitted';
  IF f.capacity IS NOT NULL THEN
    SELECT count(*) INTO taken FROM registrations
     WHERE form_id = p_form_id AND status IN ('submitted', 'under_review', 'accepted')
       AND (existing.id IS NULL OR id <> existing.id);
    IF taken >= f.capacity THEN
      IF f.waitlist_when_full THEN new_status := 'waitlisted';
      ELSE RETURN jsonb_build_object('error', 'This programme is full.');
      END IF;
    END IF;
  END IF;

  pay_status := CASE WHEN f.requires_payment THEN 'pending' ELSE 'not_required' END;

  IF existing.id IS NULL THEN
    new_ref := _reg_next_reference(p_form_id);
    -- Only guests get a token. A signed-in student reaches their registration
    -- through their session, and an extra secret would be one more thing that
    -- can leak for no gain.
    g_token := CASE WHEN uid IS NULL
                 THEN encode(gen_random_bytes(24), 'hex') END;

    INSERT INTO registrations (
      form_id, user_id, reference, answers, form_snapshot, registered_by,
      beneficiary_name, status, payment_status, amount, submitted_at,
      guest_email, guest_name, guest_phone, claim_token
    ) VALUES (
      p_form_id, uid, new_ref, COALESCE(p_answers, '{}'::jsonb), f.fields, uid,
      NULLIF(trim(COALESCE(p_beneficiary, '')), ''), new_status, pay_status,
      CASE WHEN f.requires_payment THEN f.fee_amount END, now(),
      g_email, g_name, g_phone, g_token
    )
    RETURNING id, reference INTO rid, new_ref;
  ELSE
    UPDATE registrations SET
      answers = COALESCE(p_answers, '{}'::jsonb),
      form_snapshot = f.fields,
      beneficiary_name = NULLIF(trim(COALESCE(p_beneficiary, '')), ''),
      status = new_status,
      submitted_at = COALESCE(submitted_at, now()),
      guest_name  = COALESCE(g_name,  guest_name),
      guest_phone = COALESCE(g_phone, guest_phone),
      updated_at = now()
    WHERE id = existing.id
    RETURNING id, reference, claim_token INTO rid, new_ref, g_token;
  END IF;

  -- Answer memory belongs to an account. A guest has nowhere to remember to,
  -- which is exactly what claim_guest_registrations later fixes.
  IF uid IS NOT NULL THEN
    FOR fld IN SELECT * FROM jsonb_array_elements(COALESCE(f.fields, '[]'::jsonb)) LOOP
      k := fld ->> 'key';
      CONTINUE WHEN k IS NULL OR (fld ->> 'remember') IS DISTINCT FROM 'true';
      CONTINUE WHEN p_answers -> k IS NULL OR p_answers ->> k = '';

      INSERT INTO user_answer_memory (user_id, field_key, value, updated_at)
      VALUES (uid, k, p_answers -> k, now())
      ON CONFLICT (user_id, field_key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'id', rid, 'reference', new_ref, 'status', new_status,
    'paymentStatus', pay_status, 'amount', f.fee_amount, 'currency', f.fee_currency,
    'guest', uid IS NULL,
    'claimToken', g_token,
    'message', COALESCE(f.confirmation_message, 'Your registration has been received.')
  );
END;
$fn$;

-- ── Coming back without an account ─────────────────────────────────────────
--
-- Reference alone is not enough. References are short and sequential, so the
-- token is what actually authorises this.

CREATE OR REPLACE FUNCTION get_guest_registration(p_reference text, p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE r registrations; f registration_forms;
BEGIN
  IF COALESCE(trim(p_reference), '') = '' OR COALESCE(trim(p_token), '') = '' THEN
    RETURN jsonb_build_object('error', 'That link is incomplete.');
  END IF;

  SELECT * INTO r FROM registrations
   WHERE reference = trim(p_reference) AND claim_token = trim(p_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'We could not find that registration.');
  END IF;

  SELECT * INTO f FROM registration_forms WHERE id = r.form_id;

  RETURN jsonb_build_object(
    'id', r.id, 'reference', r.reference, 'status', r.status,
    'paymentStatus', r.payment_status, 'amount', r.amount,
    'answers', r.answers, 'submittedAt', r.submitted_at,
    'formTitle', f.title, 'programTitle', f.program_title,
    'currency', f.fee_currency
  );
END;
$fn$;

-- Paying without an account. Narrow in the same way confirm_my_payment is:
-- pending to paid, and nothing else.
CREATE OR REPLACE FUNCTION confirm_guest_payment(
  p_registration_id uuid,
  p_token text,
  p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE r registrations;
BEGIN
  SELECT * INTO r FROM registrations
   WHERE id = p_registration_id AND claim_token = NULLIF(trim(COALESCE(p_token, '')), '');
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'We could not find that registration.');
  END IF;
  IF r.payment_status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'alreadyPaid', true);
  END IF;

  UPDATE registrations SET
    payment_status = 'paid',
    payment_reference = NULLIF(trim(COALESCE(p_reference, '')), ''),
    paid_at = now(),
    paid_by = 'guest (card)',
    updated_at = now()
  WHERE id = r.id;

  RETURN jsonb_build_object('ok', true);
END;
$fn$;

-- ── Joining guest entries to a new account ─────────────────────────────────
--
-- Called after sign in. Everything registered as a guest with this account's
-- email becomes theirs, and the answers they gave become memory, so the next
-- form is short. Without this, anyone who registered before signing up would
-- keep retyping their school forever.

CREATE OR REPLACE FUNCTION claim_guest_registrations()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE
  uid     uuid := auth.uid();
  my_mail text;
  r       registrations;
  fld     jsonb;
  k       text;
  moved   integer := 0;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in first.');
  END IF;

  SELECT lower(email) INTO my_mail FROM users WHERE id = uid;
  IF my_mail IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'claimed', 0);
  END IF;

  FOR r IN
    SELECT * FROM registrations
     WHERE user_id IS NULL AND lower(guest_email) = my_mail
  LOOP
    -- A form they have already entered while signed in keeps the signed-in
    -- row. Two rows for one person on one form would double-count capacity.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM registrations
       WHERE form_id = r.form_id AND user_id = uid
    );

    UPDATE registrations SET
      user_id = uid,
      registered_by = uid,
      claimed_at = now(),
      claim_token = NULL,          -- the account is the way in from now on
      updated_at = now()
    WHERE id = r.id;

    moved := moved + 1;

    FOR fld IN SELECT * FROM jsonb_array_elements(COALESCE(r.form_snapshot, '[]'::jsonb)) LOOP
      k := fld ->> 'key';
      CONTINUE WHEN k IS NULL OR (fld ->> 'remember') IS DISTINCT FROM 'true';
      CONTINUE WHEN r.answers -> k IS NULL OR r.answers ->> k = '';

      INSERT INTO user_answer_memory (user_id, field_key, value, updated_at)
      VALUES (uid, k, r.answers -> k, now())
      ON CONFLICT (user_id, field_key)
        DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'claimed', moved);
END;
$fn$;

-- ── Grants ─────────────────────────────────────────────────────────────────
--
-- anon reaches these functions and nothing else. registrations still has no
-- anon policy of any kind, so a guest cannot read a row directly even with a
-- reference in hand.

GRANT EXECUTE ON FUNCTION get_registration_prefill(uuid)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_registration(uuid, jsonb, text)      TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_guest_registration(text, text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_guest_payment(uuid, text, text)     TO anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_guest_registrations()                 TO authenticated;

REVOKE EXECUTE ON FUNCTION _reg_answer_for(jsonb, jsonb, text, text[])
  FROM PUBLIC, anon, authenticated;

-- Verify:
--   SELECT proname, pg_get_function_identity_arguments(oid)
--     FROM pg_proc WHERE proname LIKE '%guest%';
--   SELECT count(*) FROM registrations WHERE user_id IS NULL;
