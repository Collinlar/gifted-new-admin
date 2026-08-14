-- ═══════════════════════════════════════════════════════════════════════════
-- REGISTRATIONS
--
-- Replaces the scattering of Google Forms with one structured intake that
-- knows who is filling it in.
--
-- Three tables:
--   registration_forms   the questions for one programme intake
--   registrations        one submission, per person per form
--   user_answer_memory   what this person has already told us, ever
--
-- The third is the one that matters. A Google Form cannot know the person
-- filling it in, so every form asks for a school and a phone number again.
-- Here, any field carrying a stable key is remembered, and every later form
-- using that key arrives already answered. The first olympiad asks fifteen
-- questions; the fourth asks two.
--
-- Access model: students reach their own rows through RLS on their logged in
-- session. Admin reads go through the admin server with the service role.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Forms ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS registration_forms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text        NOT NULL,
  description   text,

  -- Polymorphic, so one builder serves competitions, camps and courses
  program_type  text        NOT NULL DEFAULT 'competition',  -- competition | camp | course | standalone
  program_id    uuid,
  program_title text,                                        -- denormalised for listing

  -- [{ id, key, label, type, required, options, placeholder, help,
  --    source, remember, half }]
  fields        jsonb       NOT NULL DEFAULT '[]'::jsonb,

  opens_at      timestamptz,
  closes_at     timestamptz,
  capacity      integer,                                     -- null = uncapped
  waitlist_when_full boolean NOT NULL DEFAULT true,

  requires_payment boolean  NOT NULL DEFAULT false,
  fee_amount    numeric(10,2),
  fee_currency  text        NOT NULL DEFAULT 'GHS',

  status        text        NOT NULL DEFAULT 'draft',        -- draft | open | closed
  confirmation_message text,
  reference_prefix text,                                     -- e.g. GHMATH

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS registration_forms_program_idx ON registration_forms(program_type, program_id);
CREATE INDEX IF NOT EXISTS registration_forms_status_idx  ON registration_forms(status);

-- ── Submissions ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS registrations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id       uuid        NOT NULL REFERENCES registration_forms(id) ON DELETE CASCADE,
  user_id       uuid        NOT NULL,
  reference     text        UNIQUE,

  answers       jsonb       NOT NULL DEFAULT '{}'::jsonb,

  -- The questions exactly as they stood when this was submitted. Editing a
  -- live form must not silently rewrite what 200 people already answered.
  form_snapshot jsonb,

  -- Reserved for the parent and child link that does not exist yet. Today a
  -- parent registering a child creates a student account, so these stay null
  -- and every registration belongs to one account. When the relationship is
  -- built, existing rows can be repointed without a schema change.
  registered_by uuid,                                        -- the account that submitted
  beneficiary_name text,                                     -- who it is actually for

  status        text        NOT NULL DEFAULT 'draft',
    -- draft | submitted | under_review | accepted | waitlisted | rejected | withdrawn
  payment_status text      NOT NULL DEFAULT 'not_required',
    -- not_required | pending | paid | refunded
  payment_reference text,
  amount        numeric(10,2),

  submitted_at  timestamptz,
  decided_at    timestamptz,
  decided_by    text,
  decision_note text,

  -- Set on rows brought in from a Google Form export, so imported history is
  -- distinguishable from something a student filled in here.
  imported_from text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (form_id, user_id)
);

CREATE INDEX IF NOT EXISTS registrations_form_idx   ON registrations(form_id, status);
CREATE INDEX IF NOT EXISTS registrations_user_idx   ON registrations(user_id);
CREATE INDEX IF NOT EXISTS registrations_status_idx ON registrations(status);

-- ── Answer memory ──────────────────────────────────────────────────────────
-- One row per person per field key, holding their most recent answer. This is
-- what makes the second and every later form short.

CREATE TABLE IF NOT EXISTS user_answer_memory (
  user_id    uuid        NOT NULL,
  field_key  text        NOT NULL,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, field_key)
);

-- ── Row level security ─────────────────────────────────────────────────────
-- Students act through their own session, so these policies are the whole
-- guard. The admin server uses the service role, which bypasses them.

ALTER TABLE registration_forms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE registrations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_answer_memory  ENABLE ROW LEVEL SECURITY;

-- Anyone may read a form that is actually open. Draft and closed forms stay
-- invisible so an unannounced intake cannot be found early.
DROP POLICY IF EXISTS "open forms are readable" ON registration_forms;
CREATE POLICY "open forms are readable"
  ON registration_forms FOR SELECT
  TO anon, authenticated
  USING (status = 'open');

DROP POLICY IF EXISTS "own registrations readable" ON registrations;
CREATE POLICY "own registrations readable"
  ON registrations FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own registrations insertable" ON registrations;
CREATE POLICY "own registrations insertable"
  ON registrations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- A student may edit their own submission, but only while it is still theirs
-- to edit. Once a decision has been recorded the row is out of their hands.
DROP POLICY IF EXISTS "own drafts updatable" ON registrations;
CREATE POLICY "own drafts updatable"
  ON registrations FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND status IN ('draft', 'submitted'))
  WITH CHECK (user_id = auth.uid() AND status IN ('draft', 'submitted'));

DROP POLICY IF EXISTS "own memory readable" ON user_answer_memory;
CREATE POLICY "own memory readable"
  ON user_answer_memory FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "own memory writable" ON user_answer_memory;
CREATE POLICY "own memory writable"
  ON user_answer_memory FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "own memory updatable" ON user_answer_memory;
CREATE POLICY "own memory updatable"
  ON user_answer_memory FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Reference allocation ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION _reg_next_reference(p_form_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  prefix text;
  n      integer;
  cand   text;
BEGIN
  SELECT COALESCE(
           NULLIF(upper(regexp_replace(COALESCE(reference_prefix, title), '[^A-Za-z0-9]', '', 'g')), ''),
           'REG')
    INTO prefix
    FROM registration_forms WHERE id = p_form_id;

  prefix := left(prefix, 10);
  SELECT count(*) INTO n FROM registrations WHERE form_id = p_form_id;

  LOOP
    n := n + 1;
    cand := prefix || '-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, 4, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM registrations WHERE reference = cand);
  END LOOP;

  RETURN cand;
END;
$$;

-- ── Submit ─────────────────────────────────────────────────────────────────
-- Runs as one operation so the capacity check, the reference, the snapshot and
-- the memory write cannot drift apart. Called by the student's own session.

CREATE OR REPLACE FUNCTION submit_registration(
  p_form_id uuid,
  p_answers jsonb,
  p_beneficiary text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid       uuid := auth.uid();
  f         registration_forms;
  existing  registrations;
  taken     integer;
  new_ref   text;
  new_status text;
  pay_status text;
  fld       jsonb;
  k         text;
  rid       uuid;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in to register.');
  END IF;

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

  SELECT * INTO existing FROM registrations WHERE form_id = p_form_id AND user_id = uid;
  IF FOUND AND existing.status NOT IN ('draft', 'submitted') THEN
    RETURN jsonb_build_object('error', 'Your registration has already been reviewed and cannot be changed.');
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
    INSERT INTO registrations (
      form_id, user_id, reference, answers, form_snapshot, registered_by,
      beneficiary_name, status, payment_status, amount, submitted_at
    ) VALUES (
      p_form_id, uid, new_ref, COALESCE(p_answers, '{}'::jsonb), f.fields, uid,
      NULLIF(trim(COALESCE(p_beneficiary, '')), ''), new_status, pay_status,
      CASE WHEN f.requires_payment THEN f.fee_amount END, now()
    )
    RETURNING id, reference INTO rid, new_ref;
  ELSE
    UPDATE registrations SET
      answers = COALESCE(p_answers, '{}'::jsonb),
      form_snapshot = f.fields,
      beneficiary_name = NULLIF(trim(COALESCE(p_beneficiary, '')), ''),
      status = new_status,
      submitted_at = COALESCE(submitted_at, now()),
      updated_at = now()
    WHERE id = existing.id
    RETURNING id, reference INTO rid, new_ref;
  END IF;

  -- Remember every answer whose field asked to be remembered, so the next form
  -- arrives already filled in.
  FOR fld IN SELECT * FROM jsonb_array_elements(COALESCE(f.fields, '[]'::jsonb)) LOOP
    k := fld ->> 'key';
    CONTINUE WHEN k IS NULL OR (fld ->> 'remember') IS DISTINCT FROM 'true';
    CONTINUE WHEN p_answers -> k IS NULL OR p_answers ->> k = '';

    INSERT INTO user_answer_memory (user_id, field_key, value, updated_at)
    VALUES (uid, k, p_answers -> k, now())
    ON CONFLICT (user_id, field_key)
      DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END LOOP;

  RETURN jsonb_build_object(
    'id', rid, 'reference', new_ref, 'status', new_status,
    'paymentStatus', pay_status, 'amount', f.fee_amount, 'currency', f.fee_currency,
    'message', COALESCE(f.confirmation_message, 'Your registration has been received.')
  );
END;
$$;

-- ── Prefill ────────────────────────────────────────────────────────────────
-- Everything already known about this person, in one call: their profile, what
-- they have answered before, and any draft in progress.

CREATE OR REPLACE FUNCTION get_registration_prefill(p_form_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  prof record;
  mem jsonb;
  existing registrations;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('error', 'Sign in to register.');
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
    ) END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_registration(uuid, jsonb, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION get_registration_prefill(uuid)          TO authenticated;
REVOKE EXECUTE ON FUNCTION _reg_next_reference(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION _reg_next_reference(uuid) TO service_role;
