-- Run after exam_mode_v2.sql and registrations_v4.sql (or later versions).
-- Does not change individual registration or existing exam login functions.
ALTER TABLE exam_candidates ADD COLUMN IF NOT EXISTS registration_id uuid
  REFERENCES registrations(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS exam_candidates_registration_unique
  ON exam_candidates(session_id, registration_id) WHERE registration_id IS NOT NULL;

CREATE OR REPLACE FUNCTION admin_exam_registration_preview(p_session_id uuid, p_form_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM exam_sessions WHERE id=p_session_id) THEN
    RAISE EXCEPTION 'That exam sitting no longer exists.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM registration_forms WHERE id=p_form_id) THEN
    RAISE EXCEPTION 'That registration form no longer exists.';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', r.id, 'fullName', n.full_name, 'school',
      COALESCE(_reg_answer_for(COALESCE(r.form_snapshot,f.fields),r.answers,'profile.school_name',ARRAY['school_name','school']),u.school_name),
      'grade', COALESCE(_reg_answer_for(COALESCE(r.form_snapshot,f.fields),r.answers,'profile.grade',ARRAY['grade']),u.grade::text),
      'status',r.status,'paymentStatus',r.payment_status,
      'alreadyAdded', EXISTS (SELECT 1 FROM exam_candidates c WHERE c.session_id=p_session_id AND c.registration_id=r.id),
      'eligible', r.status IN ('submitted','under_review','accepted','waitlisted') AND n.full_name IS NOT NULL
    ) ORDER BY n.full_name NULLS LAST, r.id)
    FROM registrations r JOIN registration_forms f ON f.id=r.form_id
    LEFT JOIN users u ON u.id=r.user_id
    CROSS JOIN LATERAL (SELECT COALESCE(
      NULLIF(trim(r.beneficiary_name),''), NULLIF(trim(r.guest_name),''),
      _reg_answer_for(COALESCE(r.form_snapshot,f.fields),r.answers,'profile.full_name',ARRAY['full_name','name']),
      NULLIF(trim(concat_ws(' ',
        _reg_answer_for(COALESCE(r.form_snapshot,f.fields),r.answers,'profile.first_name',ARRAY['first_name']),
        _reg_answer_for(COALESCE(r.form_snapshot,f.fields),r.answers,'profile.last_name',ARRAY['last_name']))),''),
      NULLIF(trim(concat_ws(' ',u.first_name,u.last_name)),'')) AS full_name) n
    WHERE r.form_id=p_form_id
  ),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION admin_add_registration_candidates(
  p_session_id uuid, p_form_id uuid, p_registration_ids uuid[], p_actor text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
DECLARE
  item jsonb; generated jsonb; candidate_id uuid; owner_id uuid;
  created integer := 0; skipped integer := 0; sitting_status text;
BEGIN
  IF COALESCE(cardinality(p_registration_ids),0)=0 OR cardinality(p_registration_ids)>1000 THEN
    RAISE EXCEPTION 'Select between 1 and 1000 registrations.';
  END IF;
  -- Serialize additions to this sitting, including concurrent repeat requests.
  SELECT status INTO sitting_status FROM exam_sessions WHERE id=p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That exam sitting no longer exists.'; END IF;
  IF sitting_status='closed' THEN RAISE EXCEPTION 'This exam sitting is closed.'; END IF;
  PERFORM id FROM registrations WHERE id=ANY(p_registration_ids) ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM unnest(p_registration_ids) selected(id)
    WHERE NOT EXISTS (SELECT 1 FROM registrations r WHERE r.id=selected.id AND r.form_id=p_form_id)) THEN
    RAISE EXCEPTION 'A selected registration is no longer in this form. Refresh the list.';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(admin_exam_registration_preview(p_session_id,p_form_id))
    WHERE (value->>'id')::uuid=ANY(p_registration_ids)
  LOOP
    IF (item->>'alreadyAdded')::boolean THEN skipped := skipped+1; CONTINUE; END IF;
    IF NOT (item->>'eligible')::boolean THEN
      RAISE EXCEPTION 'A selected registration is missing a name or is no longer eligible. Refresh the list.';
    END IF;
    SELECT user_id INTO owner_id FROM registrations WHERE id=(item->>'id')::uuid;
    generated := admin_generate_candidates(p_session_id,jsonb_build_array(jsonb_build_object(
      'full_name',item->>'fullName','school',item->>'school','grade',item->>'grade','user_id',owner_id)));
    candidate_id := (generated->'candidates'->0->>'id')::uuid;
    UPDATE exam_candidates SET registration_id=(item->>'id')::uuid WHERE id=candidate_id;
    created := created+1;
  END LOOP;
  PERFORM _exam_audit(p_session_id,NULL,p_actor,'candidate.registration_import',
    jsonb_build_object('formId',p_form_id,'registrationIds',p_registration_ids,'created',created,'skipped',skipped));
  RETURN jsonb_build_object('created',created,'skipped',skipped);
END $$;

REVOKE ALL ON FUNCTION admin_exam_registration_preview(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION admin_add_registration_candidates(uuid,uuid,uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION admin_exam_registration_preview(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION admin_add_registration_candidates(uuid,uuid,uuid[],text) TO service_role;
