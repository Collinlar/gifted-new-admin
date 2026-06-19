-- Deduplicate course_progress rows, keeping the one with the most step completions
-- (or the latest created_at as tiebreaker), then add a unique constraint so
-- upsert-based progress tracking works correctly.

-- Step 1: For each (user_id, course_id) pair that has duplicates, remove all but
-- the row with the largest step_status array (most progress).
DELETE FROM course_progress
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY user_id, course_id
        ORDER BY jsonb_array_length(COALESCE(step_status, '[]'::jsonb)) DESC, created_at DESC
      ) AS rn
    FROM course_progress
  ) ranked
  WHERE rn > 1
);

-- Step 2: Add unique constraint so future upserts work correctly.
ALTER TABLE course_progress
  ADD CONSTRAINT course_progress_user_course_unique UNIQUE (user_id, course_id);
