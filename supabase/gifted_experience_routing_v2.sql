-- Gifted Experience v2: reusable skill-to-content mappings and result-based routes.
-- Apply after gifted_experience_v1.sql.

create table if not exists public.skill_content_mappings (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id),
  skill_id uuid not null references public.track_skills(id) on delete cascade,
  outcome text not null check (outcome in ('needs_development','verify_skill','demonstrated_strength','insufficient_evidence')),
  item_type text not null check (item_type in ('course','exam','competition','camp')),
  item_id uuid not null,
  title text not null check (length(title) between 1 and 200),
  description text not null default '' check (length(description) <= 2000),
  href text not null check (left(href,1)='/' and left(href,2)<>'//' and length(href)<=1000),
  priority integer not null default 100 check (priority between 0 and 10000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(skill_id,outcome,item_type,item_id)
);

alter table public.skill_content_mappings enable row level security;
revoke all on public.skill_content_mappings from anon, authenticated;
grant select,insert,update,delete on public.skill_content_mappings to service_role;

create or replace function public.gifted_experience_state(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a public.gifted_experience_assignments;
  snap jsonb;
  progress public.gifted_experience_progress;
  step jsonb;
  completed jsonb;
  submitted boolean;
  report jsonb;
  findings jsonb := '[]'::jsonb;
  applicable_steps jsonb := '[]'::jsonb;
  recommendations jsonb := '[]'::jsonb;
  current_id text;
  outcome text;
  skill_id text;
  target_status text;
  applies boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to view your Gifted Experience.'; end if;
  select * into a from public.gifted_experience_assignments where id=p_assignment and user_id=auth.uid() and active;
  if not found then raise exception 'This Gifted Experience is not assigned to your account.'; end if;
  select snapshot into snap from public.gifted_experience_versions where experience_id=a.experience_id and version=a.version;
  insert into public.gifted_experience_progress(assignment_id,user_id) values(a.id,auth.uid()) on conflict(assignment_id) do nothing;
  select * into progress from public.gifted_experience_progress where assignment_id=a.id for update;
  completed := progress.completed_steps;

  for step in select value from jsonb_array_elements(snap->'steps') loop
    if step->>'type'='diagnostic' then
      select t.submitted_at is not null, t.report into submitted, report
      from public.diagnostic_assignments da left join public.diagnostic_attempts t on t.assignment_id=da.id
      where da.user_id=auth.uid() and da.diagnostic_id=(step->>'diagnosticId')::uuid
        and da.version=(step->>'diagnosticVersion')::integer and da.active
      order by da.created_at desc limit 1;
      if coalesce(submitted,false) then
        completed := jsonb_set(completed,array[step->>'id'],'true'::jsonb,true);
        findings := findings || coalesce(report->'findings','[]'::jsonb);
      end if;
    end if;
  end loop;

  for step in select value from jsonb_array_elements(snap->'steps') loop
    outcome := coalesce(step->'condition'->>'outcome','always');
    skill_id := nullif(step->'condition'->>'skillId','');
    applies := false;
    if step->>'type'='diagnostic' or outcome='always' then
      applies := true;
    elsif outcome='all_demonstrated_strength' then
      select exists(select 1 from jsonb_array_elements(findings) f where skill_id is null or f->'skill'->>'id'=skill_id)
        and not exists(select 1 from jsonb_array_elements(findings) f where (skill_id is null or f->'skill'->>'id'=skill_id) and f->>'status'<>'Demonstrated strength') into applies;
    else
      target_status := case outcome when 'needs_development' then 'Needs development' when 'verify_skill' then 'Verify this skill'
        when 'demonstrated_strength' then 'Demonstrated strength' else 'Insufficient evidence' end;
      select exists(select 1 from jsonb_array_elements(findings) f where (skill_id is null or f->'skill'->>'id'=skill_id) and f->>'status'=target_status) into applies;
    end if;
    if applies then
      applicable_steps := applicable_steps || jsonb_build_array(step);
      if current_id is null and coalesce((completed->>(step->>'id'))::boolean,false)=false then current_id := step->>'id'; end if;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',matched.id,'skill',matched.skill,'status',matched.status,'type',matched.item_type,'itemId',matched.item_id,
    'title',matched.title,'description',matched.description,'href',matched.href,'priority',matched.priority
  ) order by matched.priority,matched.title),'[]'::jsonb) into recommendations
  from (
    select distinct on (m.id) m.id,m.item_type,m.item_id,m.title,m.description,m.href,m.priority,f->'skill' skill,f->>'status' status
    from public.skill_content_mappings m join jsonb_array_elements(findings) f on f->'skill'->>'id'=m.skill_id::text
    where m.track_id=a.track_id and m.active and m.outcome=case f->>'status'
      when 'Needs development' then 'needs_development' when 'Verify this skill' then 'verify_skill'
      when 'Demonstrated strength' then 'demonstrated_strength' else 'insufficient_evidence' end
    order by m.id,m.priority
  ) matched;

  update public.gifted_experience_progress set completed_steps=completed,updated_at=now() where assignment_id=a.id;
  return jsonb_build_object('assignmentId',a.id,'version',a.version,'snapshot',snap,'steps',applicable_steps,'completed',completed,
    'currentStepId',current_id,'isComplete',current_id is null,'findings',findings,'recommendations',recommendations);
end $$;
revoke all on function public.gifted_experience_state(uuid) from public,anon;
grant execute on function public.gifted_experience_state(uuid) to authenticated;

create or replace function public.complete_gifted_experience_step(p_assignment uuid,p_step text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare state jsonb; step jsonb;
begin
  state := public.gifted_experience_state(p_assignment);
  if state->>'currentStepId' is distinct from p_step then raise exception 'Complete the current stage before moving ahead.'; end if;
  select value into step from jsonb_array_elements(state->'steps') where value->>'id'=p_step;
  if step is null then raise exception 'Journey stage not found or does not apply to your diagnostic result.'; end if;
  if step->>'type'='diagnostic' then raise exception 'Submit the diagnostic to complete this stage.'; end if;
  update public.gifted_experience_progress set completed_steps=jsonb_set(completed_steps,array[p_step],'true'::jsonb,true),updated_at=now()
  where assignment_id=p_assignment and user_id=auth.uid();
  return public.gifted_experience_state(p_assignment);
end $$;
revoke all on function public.complete_gifted_experience_step(uuid,text) from public,anon;
grant execute on function public.complete_gifted_experience_step(uuid,text) to authenticated;
