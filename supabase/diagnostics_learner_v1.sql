-- Learner attempt foundation. Apply after diagnostics_v1.sql.
-- Assignments are explicit: publishing alone never exposes a diagnostic.
begin;
create table if not exists public.diagnostic_assignments (
  id uuid primary key default gen_random_uuid(),
  diagnostic_id uuid not null,
  version integer not null,
  track_id uuid not null references public.tracks(id),
  user_id uuid not null references auth.users(id),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key(diagnostic_id,version) references public.diagnostic_versions(diagnostic_id,version),
  unique(diagnostic_id,version,user_id)
);
create table if not exists public.diagnostic_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.diagnostic_assignments(id),
  user_id uuid not null references auth.users(id),
  answers jsonb not null default '{}',
  revision integer not null default 1,
  submitted_at timestamptz,
  report jsonb,
  updated_at timestamptz not null default now()
);
alter table public.diagnostic_assignments enable row level security;
alter table public.diagnostic_attempts enable row level security;
revoke all on public.diagnostic_assignments, public.diagnostic_attempts from anon, authenticated;
grant select,insert,update on public.diagnostic_assignments, public.diagnostic_attempts to service_role;
create or replace function public.learner_diagnostic(p_assignment uuid, p_answers jsonb default null, p_revision integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a public.diagnostic_assignments; attempt public.diagnostic_attempts; paper jsonb; pair record; question jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to take your diagnostic.'; end if;
  select * into a from diagnostic_assignments where id=p_assignment and user_id=auth.uid() and active for share;
  if not found then raise exception 'This diagnostic is not assigned to your account.'; end if;
  select snapshot into paper from diagnostic_versions where diagnostic_id=a.diagnostic_id and version=a.version;
  insert into diagnostic_attempts(assignment_id,user_id) values(a.id,auth.uid()) on conflict(assignment_id) do nothing;
  select * into attempt from diagnostic_attempts where assignment_id=a.id for update;
  if p_answers is not null then
    if attempt.submitted_at is not null then raise exception 'This diagnostic has already been submitted.'; end if;
    if p_revision is distinct from attempt.revision then raise exception 'Your answers changed in another session. Reload before saving.' using errcode='40001'; end if;
    if jsonb_typeof(p_answers) <> 'object' then raise exception 'Answers must be an object.'; end if;
    for pair in select * from jsonb_each(p_answers) loop
      select q into question from jsonb_array_elements(paper->'questions') q where q->>'id'=pair.key;
      if question is null or jsonb_typeof(pair.value) <> 'number' or pair.value::text !~ '^[0-9]+$' then raise exception 'Invalid question or answer.'; end if;
      if (pair.value::text)::numeric >= jsonb_array_length(question->'options') then raise exception 'Answer is outside the available options.'; end if;
    end loop;
    update diagnostic_attempts set answers=p_answers, revision=revision+1, updated_at=now() where id=attempt.id returning * into attempt;
  end if;
  -- Never send answer keys or explanations before submission.
  paper := jsonb_set(paper,'{questions}',coalesce((select jsonb_agg(q-'correctIndex'-'explanation') from jsonb_array_elements(paper->'questions') q),'[]'));
  return jsonb_build_object('attempt',to_jsonb(attempt),'paper',paper,'version',a.version);
end;
$$;
revoke all on function public.learner_diagnostic(uuid,jsonb,integer) from public,anon;
grant execute on function public.learner_diagnostic(uuid,jsonb,integer) to authenticated;
create or replace function public.my_diagnostics()
returns jsonb language sql security definer set search_path = public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'trackId',a.track_id,'title',v.snapshot->>'title','audience',v.snapshot->>'audience','version',a.version,'submitted',t.submitted_at is not null,'answered',coalesce((select count(*) from jsonb_object_keys(t.answers)),0))), '[]')
 from diagnostic_assignments a join diagnostic_versions v on v.diagnostic_id=a.diagnostic_id and v.version=a.version
 left join diagnostic_attempts t on t.assignment_id=a.id where a.user_id=auth.uid() and a.active;
$$;
revoke all on function public.my_diagnostics() from public,anon;
grant execute on function public.my_diagnostics() to authenticated;

create or replace function public.submit_diagnostic(p_assignment uuid, p_revision integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare attempt public.diagnostic_attempts; a public.diagnostic_assignments; paper jsonb; skill jsonb; q jsonb; c jsonb;
  answered integer; correct integer; total integer; inconsistent boolean; level_missing boolean; status text; findings jsonb := '[]'; result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to submit your diagnostic.'; end if;
  select * into a from diagnostic_assignments where id=p_assignment and user_id=auth.uid() and active for share;
  if not found then raise exception 'This diagnostic is not assigned to your account.'; end if;
  select * into attempt from diagnostic_attempts where assignment_id=a.id for update;
  if not found then raise exception 'Save your answers before submitting.'; end if;
  if attempt.submitted_at is not null then return attempt.report; end if;
  if attempt.revision is distinct from p_revision then raise exception 'Your answers changed. Reload before submitting.' using errcode='40001'; end if;
  select snapshot into paper from diagnostic_versions where diagnostic_id=a.diagnostic_id and version=a.version;
  for skill in select * from jsonb_array_elements(paper->'skills') loop
    select count(*),count(*) filter(where attempt.answers ? (x->>'id')),count(*) filter(where attempt.answers->(x->>'id')=x->'correctIndex')
      into total,answered,correct from jsonb_array_elements(paper->'questions') x where x->>'skillId'=skill->>'id';
    select exists(select 1 from unnest(array['beginner','intermediate','advanced']) l where not exists(select 1 from jsonb_array_elements(paper->'questions') x where x->>'skillId'=skill->>'id' and x->>'difficulty'=l and attempt.answers ? (x->>'id'))) into level_missing;
    inconsistent := false;
    for q in select * from jsonb_array_elements(paper->'questions') x where x->>'skillId'=skill->>'id' and attempt.answers ? (x->>'id') and attempt.answers->(x->>'id')<>x->'correctIndex' loop
      for c in select * from jsonb_array_elements(paper->'questions') x where x->>'skillId'=skill->>'id' and attempt.answers->(x->>'id')=x->'correctIndex' loop
        if array_position(array['beginner','intermediate','advanced'],c->>'difficulty') > array_position(array['beginner','intermediate','advanced'],q->>'difficulty') then inconsistent := true; end if;
      end loop;
    end loop;
    status := case when answered < (paper->>'minimumEvidence')::integer or level_missing then 'Insufficient evidence' when inconsistent then 'Verify this skill' when correct::numeric/nullif(answered,0)*100 >= (paper->>'targetPercent')::numeric then 'Demonstrated strength' else 'Needs development' end;
    findings := findings || jsonb_build_array(jsonb_build_object('skill',skill,'status',status,'answered',answered,'correct',correct,'total',total));
  end loop;
  result := jsonb_build_object('title',paper->>'title','version',a.version,'findings',findings,'questions',paper->'questions','answers',attempt.answers);
  update diagnostic_attempts set report=result,submitted_at=now(),updated_at=now(),revision=revision+1 where id=attempt.id;
  return result;
end;
$$;
revoke all on function public.submit_diagnostic(uuid,integer) from public,anon;
grant execute on function public.submit_diagnostic(uuid,integer) to authenticated;
commit;
