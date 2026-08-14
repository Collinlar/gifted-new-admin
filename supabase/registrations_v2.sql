-- ═══════════════════════════════════════════════════════════════════════════
-- REGISTRATIONS v2 — shareable links and form presentation
--
-- Run after registrations.sql. Idempotent.
--
-- A registration link has to be something you can put in a WhatsApp broadcast
-- or read down a phone. A uuid is neither, so each form gets a slug and the
-- student route accepts it.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE registration_forms
  ADD COLUMN IF NOT EXISTS slug            text,
  ADD COLUMN IF NOT EXISTS cover_image_url text,
  ADD COLUMN IF NOT EXISTS accent_color    text NOT NULL DEFAULT '#003366',
  ADD COLUMN IF NOT EXISTS intro_heading   text;

-- Backfill from the reference prefix, then the title, for forms that predate
-- this. Deduplicated with a numeric suffix.
DO $$
DECLARE
  r      record;
  base   text;
  cand   text;
  n      integer;
BEGIN
  FOR r IN SELECT id, title, reference_prefix FROM registration_forms WHERE slug IS NULL LOOP
    base := upper(regexp_replace(COALESCE(NULLIF(r.reference_prefix, ''), r.title), '[^A-Za-z0-9]+', '-', 'g'));
    base := trim(both '-' from base);
    base := left(COALESCE(NULLIF(base, ''), 'FORM'), 40);

    cand := base;
    n := 1;
    WHILE EXISTS (SELECT 1 FROM registration_forms WHERE upper(slug) = cand) LOOP
      n := n + 1;
      cand := base || '-' || n;
    END LOOP;

    UPDATE registration_forms SET slug = cand WHERE id = r.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS registration_forms_slug_key
  ON registration_forms (upper(slug));

-- ── Resolve a slug without exposing anything else ──────────────────────────
--
-- RLS only lets a student read open forms, which is right, but it also means a
-- draft or closed form looks identical to a typo. This says which it is, so the
-- page can explain rather than shrug.

CREATE OR REPLACE FUNCTION resolve_registration_form(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $$
DECLARE f registration_forms;
BEGIN
  SELECT * INTO f FROM registration_forms
   WHERE upper(slug) = upper(trim(p_slug))
      OR (p_slug ~ '^[0-9a-fA-F-]{36}$' AND id = p_slug::uuid);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('found', false,
      'error', 'We could not find that registration. Check the link and try again.');
  END IF;

  IF f.status = 'draft' THEN
    RETURN jsonb_build_object('found', false,
      'error', 'Registration for this programme has not opened yet.');
  END IF;
  IF f.status = 'closed' THEN
    RETURN jsonb_build_object('found', false,
      'error', 'Registration for this programme has closed.');
  END IF;

  RETURN jsonb_build_object('found', true, 'form', to_jsonb(f));
END;
$$;

GRANT EXECUTE ON FUNCTION resolve_registration_form(text) TO anon, authenticated;
