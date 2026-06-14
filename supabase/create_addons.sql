-- Run in Supabase SQL Editor
-- Table: addons

create table if not exists addons (
  id          uuid        default gen_random_uuid() primary key,
  mongo_id    text        unique,
  name        text        not null,
  description text,
  cost        text,
  type        text,
  image       text,
  content     jsonb,
  is_active   boolean     default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists addons_is_active_idx on addons(is_active);
