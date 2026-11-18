-- Dedicated diagnostic authoring. Apply in Supabase SQL Editor before using the builder.
-- No existing assessments, questions, practice tables, or learner routes are changed.
begin;
create table if not exists public.track_skills (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete restrict,
  topic text not null check (length(trim(topic)) > 0),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);
create unique index if not exists track_skills_name_idx on public.track_skills(track_id, lower(trim(topic)), lower(trim(name)));
create table if not exists public.diagnostics (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.tracks(id) on delete restrict,
  draft jsonb not null,
  revision integer not null default 1,
  published_version integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.diagnostic_versions (
  diagnostic_id uuid not null references public.diagnostics(id) on delete restrict,
  version integer not null,
  snapshot jsonb not null,
  published_by text not null,
  published_at timestamptz not null default now(),
  primary key (diagnostic_id, version)
);
alter table public.track_skills enable row level security;
alter table public.diagnostics enable row level security;
alter table public.diagnostic_versions enable row level security;
revoke all on public.track_skills, public.diagnostics, public.diagnostic_versions from anon, authenticated;
revoke update, delete, truncate on public.diagnostic_versions from service_role;
grant select, insert on public.track_skills to service_role;
grant select, insert, update on public.diagnostics to service_role;
grant select, insert on public.diagnostic_versions to service_role;

create or replace function public.prevent_diagnostic_version_change()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Published diagnostic versions are immutable. Publish a new version instead.';
end;
$$;
drop trigger if exists diagnostic_version_immutable on public.diagnostic_versions;
create trigger diagnostic_version_immutable before update or delete on public.diagnostic_versions
for each row execute function public.prevent_diagnostic_version_change();

create or replace function public.publish_diagnostic(p_id uuid, p_revision integer, p_snapshot jsonb, p_actor text)
returns integer language plpgsql security invoker set search_path = public as $$
declare item public.diagnostics; next_version integer;
begin
  select * into item from public.diagnostics where id = p_id for update;
  if not found or item.revision <> p_revision then
    raise exception 'Diagnostic changed. Reload before publishing.' using errcode = '40001';
  end if;
  next_version := item.published_version + 1;
  insert into public.diagnostic_versions(diagnostic_id, version, snapshot, published_by)
    values(p_id, next_version, p_snapshot, p_actor);
  update public.diagnostics set published_version = next_version, revision = revision + 1, updated_at = now() where id = p_id;
  return next_version;
end;
$$;
revoke all on function public.publish_diagnostic(uuid, integer, jsonb, text) from public, anon, authenticated;
grant execute on function public.publish_diagnostic(uuid, integer, jsonb, text) to service_role;
commit;
