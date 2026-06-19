-- Learning path: structured steps stored directly on the courses row
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS steps jsonb DEFAULT '[]'::jsonb;

-- Per-user step completion tracking (alongside existing moduleStatus)
ALTER TABLE course_progress
  ADD COLUMN IF NOT EXISTS step_status jsonb DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_courses_steps ON courses USING gin(steps);
