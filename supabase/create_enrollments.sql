-- Run in Supabase SQL Editor
-- Table: enrollments
-- Tracks paid course access. user_id and course_id reference users.mongo_id
-- and courses.mongo_id respectively (MongoDB ObjectIds from the migration).

create table if not exists enrollments (
  id                 uuid        default gen_random_uuid() primary key,
  user_id            text,                      -- users.mongo_id
  course_id          text,                      -- courses.mongo_id
  payment_reference  text,                      -- Paystack transaction reference
  amount             numeric(10, 2),
  status             text        default 'active',   -- active | revoked | refunded
  enrolled_at        timestamptz default now(),
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists enrollments_user_idx   on enrollments(user_id);
create index if not exists enrollments_course_idx on enrollments(course_id);
create index if not exists enrollments_status_idx on enrollments(status);
