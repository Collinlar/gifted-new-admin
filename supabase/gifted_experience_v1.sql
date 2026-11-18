-- Gifted Experience v1: an additive, resumable journey layer.
-- Apply after diagnostics_v1.sql and diagnostics_learner_v1.sql.

create table if not exists public.gifted_experiences (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id),
  draft jsonb not null,
  revision integer not null default 1,
  published_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gifted_experience_versions (
  experience_id uuid not null references public.gifted_experiences(id) on delete restrict,
  version integer not null,
  snapshot jsonb not null,
  published_by text,
  published_at timestamptz not null default now(),
  primary key (experience_id, version)
);

create table if not exists public.gifted_experience_assignments (
  id uuid primary key default gen_random_uuid(),
  experience_id uuid not null,
  version integer not null,
  track_id uuid not null references public.tracks(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  active boolean not null default true,
  assigned_at timestamptz not null default now(),
  foreign key (experience_id, version) references public.gifted_experience_versions(experience_id, version),
  unique (experience_id, version, user_id)
);

create table if not exists public.gifted_experience_progress (
  assignment_id uuid primary key references public.gifted_experience_assignments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  completed_steps jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.gifted_experiences enable row level security;
alter table public.gifted_experience_versions enable row level security;
alter table public.gifted_experience_assignments enable row level security;
alter table public.gifted_experience_progress enable row level security;

revoke all on public.gifted_experiences, public.gifted_experience_versions, public.gifted_experience_assignments, public.gifted_experience_progress from anon, authenticated;
grant select, insert, update on public.gifted_experiences, public.gifted_experience_assignments, public.gifted_experience_progress to service_role;
grant select, insert on public.gifted_experience_versions to service_role;

create or replace function public.prevent_gifted_experience_version_change()
returns trigger language plpgsql as $$
begin
  raise exception 'Published Gifted Experience versions are immutable. Publish a new version instead.';
end $$;

drop trigger if exists gifted_experience_version_immutable on public.gifted_experience_versions;
create trigger gifted_experience_version_immutable before update or delete on public.gifted_experience_versions
for each row execute function public.prevent_gifted_experience_version_change();

create or replace function public.publish_gifted_experience(p_id uuid, p_revision integer, p_snapshot jsonb, p_actor text)
returns integer language plpgsql security definer set search_path = public as $$
declare item public.gifted_experiences; next_version integer;
begin
  select * into item from public.gifted_experiences where id = p_id for update;
  if not found then raise exception 'Gifted Experience not found.'; end if;
  if item.revision <> p_revision then raise exception using errcode = '40001', message = 'Gifted Experience changed in another session.'; end if;
  select coalesce(max(version), 0) + 1 into next_version from public.gifted_experience_versions where experience_id = p_id;
  insert into public.gifted_experience_versions(experience_id, version, snapshot, published_by) values(p_id, next_version, p_snapshot, p_actor);
  update public.gifted_experiences set published_version = next_version, revision = revision + 1, updated_at = now() where id = p_id;
  return next_version;
end $$;
revoke all on function public.publish_gifted_experience(uuid, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.publish_gifted_experience(uuid, integer, jsonb, text) to service_role;

create or replace function public.assign_gifted_experience(p_experience uuid, p_version integer, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare snap jsonb; assignment uuid; step jsonb;
begin
  select snapshot into snap from public.gifted_experience_versions where experience_id = p_experience and version = p_version;
  if snap is null then raise exception 'Published Gifted Experience not found.'; end if;
  insert into public.gifted_experience_assignments(experience_id, version, track_id, user_id, active)
  values(p_experience, p_version, (snap->>'trackId')::uuid, p_user, true)
  on conflict(experience_id, version, user_id) do update set active = true
  returning id into assignment;
  for step in select value from jsonb_array_elements(snap->'steps') loop
    if step->>'type' = 'diagnostic' then
      insert into public.diagnostic_assignments(diagnostic_id, version, track_id, user_id, active)
      values((step->>'diagnosticId')::uuid, (step->>'diagnosticVersion')::integer, (snap->>'trackId')::uuid, p_user, true)
      on conflict(diagnostic_id, version, user_id) do update set active = true;
    end if;
  end loop;
  insert into public.gifted_experience_progress(assignment_id, user_id) values(assignment, p_user) on conflict(assignment_id) do nothing;
  return assignment;
end $$;
revoke all on function public.assign_gifted_experience(uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.assign_gifted_experience(uuid, integer, uuid) to service_role;

create or replace function public.gifted_experience_state(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.gifted_experience_assignments; snap jsonb; progress public.gifted_experience_progress; step jsonb; completed jsonb; submitted boolean; current_id text;
begin
  if auth.uid() is null then raise exception 'Sign in to view your Gifted Experience.'; end if;
  select * into a from public.gifted_experience_assignments where id = p_assignment and user_id = auth.uid() and active;
  if not found then raise exception 'This Gifted Experience is not assigned to your account.'; end if;
  select snapshot into snap from public.gifted_experience_versions where experience_id = a.experience_id and version = a.version;
  insert into public.gifted_experience_progress(assignment_id, user_id) values(a.id, auth.uid()) on conflict(assignment_id) do nothing;
  select * into progress from public.gifted_experience_progress where assignment_id = a.id for update;
  completed := progress.completed_steps;
  for step in select value from jsonb_array_elements(snap->'steps') loop
    if step->>'type' = 'diagnostic' then
      select exists(
        select 1 from public.diagnostic_assignments da join public.diagnostic_attempts t on t.assignment_id = da.id
        where da.user_id = auth.uid() and da.diagnostic_id = (step->>'diagnosticId')::uuid
          and da.version = (step->>'diagnosticVersion')::integer and da.active and t.submitted_at is not null
      ) into submitted;
      if submitted then completed := jsonb_set(completed, array[step->>'id'], 'true'::jsonb, true); end if;
    end if;
  end loop;
  update public.gifted_experience_progress set completed_steps = completed, updated_at = now() where assignment_id = a.id;
  for step in select value from jsonb_array_elements(snap->'steps') loop
    if coalesce((completed->>(step->>'id'))::boolean, false) = false then current_id := step->>'id'; exit; end if;
  end loop;
  return jsonb_build_object('assignmentId', a.id, 'version', a.version, 'snapshot', snap, 'completed', completed, 'currentStepId', current_id, 'isComplete', current_id is null);
end $$;
revoke all on function public.gifted_experience_state(uuid) from public, anon;
grant execute on function public.gifted_experience_state(uuid) to authenticated;

create or replace function public.my_gifted_experiences()
returns jsonb language plpgsql security definer set search_path = public as $$
declare item record; result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to view your Gifted Experience.'; end if;
  for item in select id from public.gifted_experience_assignments where user_id = auth.uid() and active order by assigned_at desc loop
    result := result || jsonb_build_array(public.gifted_experience_state(item.id));
  end loop;
  return result;
end $$;
revoke all on function public.my_gifted_experiences() from public, anon;
grant execute on function public.my_gifted_experiences() to authenticated;

create or replace function public.complete_gifted_experience_step(p_assignment uuid, p_step text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare state jsonb; step jsonb;
begin
  state := public.gifted_experience_state(p_assignment);
  if state->>'currentStepId' is distinct from p_step then raise exception 'Complete the current stage before moving ahead.'; end if;
  select value into step from jsonb_array_elements(state->'snapshot'->'steps') where value->>'id' = p_step;
  if step is null then raise exception 'Journey stage not found.'; end if;
  if step->>'type' = 'diagnostic' then raise exception 'Submit the diagnostic to complete this stage.'; end if;
  update public.gifted_experience_progress set completed_steps = jsonb_set(completed_steps, array[p_step], 'true'::jsonb, true), updated_at = now()
  where assignment_id = p_assignment and user_id = auth.uid();
  return public.gifted_experience_state(p_assignment);
end $$;
revoke all on function public.complete_gifted_experience_step(uuid, text) from public, anon;
grant execute on function public.complete_gifted_experience_step(uuid, text) to authenticated;
