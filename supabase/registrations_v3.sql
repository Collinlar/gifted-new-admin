-- ═══════════════════════════════════════════════════════════════════════════
-- REGISTRATIONS v3 — grade targeting and payment recording
--
-- Run after registrations_v2.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE registration_forms
  -- Empty means everyone. Otherwise only these grades see the form on their
  -- dashboard. The link still works for anyone who has it, so a targeted form
  -- is a default rather than a lock: a student in the wrong grade with a good
  -- reason can still be sent it directly.
  ADD COLUMN IF NOT EXISTS target_grades text[] NOT NULL DEFAULT '{}';

ALTER TABLE registrations
  ADD COLUMN IF NOT EXISTS paid_at      timestamptz,
  ADD COLUMN IF NOT EXISTS paid_by      text,       -- who recorded it, for offline payments
  ADD COLUMN IF NOT EXISTS payment_note text;

-- ── Record a payment taken outside the platform ────────────────────────────
--
-- Most fees in Ghana arrive by mobile money, not through a card form. The
-- admin needs to be able to say "this one has paid" without pretending a
-- Paystack transaction happened.

CREATE OR REPLACE FUNCTION admin_record_payment(
  p_registration_id uuid,
  p_status text,                       -- paid | pending | refunded
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_actor text DEFAULT 'unknown'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  IF p_status NOT IN ('paid', 'pending', 'refunded', 'not_required') THEN
    RAISE EXCEPTION 'Unknown payment status: %', p_status;
  END IF;

  UPDATE registrations SET
    payment_status    = p_status,
    payment_reference = COALESCE(NULLIF(trim(COALESCE(p_reference, '')), ''), payment_reference),
    payment_note      = NULLIF(trim(COALESCE(p_note, '')), ''),
    paid_at           = CASE WHEN p_status = 'paid' THEN now() ELSE NULL END,
    paid_by           = CASE WHEN p_status = 'paid' THEN p_actor ELSE NULL END,
    updated_at        = now()
  WHERE id = p_registration_id;

  IF NOT FOUND THEN RAISE EXCEPTION 'Registration not found.'; END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION admin_record_payment(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION admin_record_payment(uuid, text, text, text, text) TO service_role;

-- ── Students may record their own card payment, nothing else ───────────────
--
-- The existing update policy lets a student edit their own row while it is a
-- draft or submitted. That is too wide once payment matters, so payment is
-- narrowed to its own path: a student can move themselves from pending to
-- paid and set a reference, and can do nothing else to the payment fields.

CREATE OR REPLACE FUNCTION confirm_my_payment(
  p_registration_id uuid,
  p_reference text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  r   registrations;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in first.');
  END IF;

  SELECT * INTO r FROM registrations WHERE id = p_registration_id AND user_id = uid;
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
    paid_by = 'student (card)',
    updated_at = now()
  WHERE id = r.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_my_payment(uuid, text) TO authenticated;
