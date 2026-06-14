-- Run in Supabase SQL Editor
-- Table: pathways

create table if not exists pathways (
  id          uuid        default gen_random_uuid() primary key,
  mongo_id    text        unique,
  title       text        not null,
  description text,
  thumbnail   text,
  courses     jsonb       default '[]',   -- array of course mongo_ids in order
  grade       text[]      default '{}',
  category    text[]      default '{}',
  tags        text[]      default '{}',
  cost        text,
  publish     boolean     default false,
  featured    boolean     default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists pathways_publish_idx on pathways(publish);
