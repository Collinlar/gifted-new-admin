-- Add missing columns to competitions table
ALTER TABLE competitions
  ADD COLUMN IF NOT EXISTS assessments text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS courses     text[] DEFAULT '{}';
