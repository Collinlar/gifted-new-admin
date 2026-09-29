-- ═══════════════════════════════════════════════════════════════════════════
-- TIMED CHALLENGES — give an authored challenge somewhere to belong
--
-- Idempotent, safe to run twice. Adds columns and indexes only. No data is
-- moved and nothing is dropped.
--
-- The two halves of this feature were built against different models and
-- never met.
--
--   Admin writes to timed_challenge_sets:
--     { title, duration, questions: [{ question, answers[], correctAnswer }] }
--   The student page reads timed_challenges, one row per question:
--     { course_id, question, options[], correct, time }
--
-- So a challenge authored in admin had no course and no track on it, which
-- meant the student side had no way to ask for "the challenge for this set"
-- even if the query had worked. It did not: it selected from the legacy
-- table and asked PostgREST to embed timed_challenge_sets, and there is no
-- foreign key between the two, so every load returned 400. Both tables are
-- empty, so this has never run with real data and nothing is at risk here.
--
-- timed_challenge_sets is the model we keep: one row is one challenge, its
-- questions in jsonb, the way a set is actually authored and played. This
-- migration gives it the same scoping columns flashcards already carry, so
-- a challenge can be attached to a course or a track and published.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE timed_challenge_sets
  -- Matches flashcards.course_id: the course's mongo_id, not its uuid. The
  -- student app passes the same value it uses for flashcards, so the two
  -- study modes over one set agree on what a course is.
  ADD COLUMN IF NOT EXISTS course_id text,
  ADD COLUMN IF NOT EXISTS track_id  uuid REFERENCES tracks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grade     text,
  ADD COLUMN IF NOT EXISTS subject   text,
  -- Unpublished by default. A half-written challenge should not appear in
  -- front of a student the moment the first question is saved.
  ADD COLUMN IF NOT EXISTS publish   boolean NOT NULL DEFAULT false;

-- Partial indexes: most rows will carry one of the two, rarely both.
CREATE INDEX IF NOT EXISTS timed_challenge_sets_course_idx
  ON timed_challenge_sets (course_id) WHERE course_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS timed_challenge_sets_track_idx
  ON timed_challenge_sets (track_id) WHERE track_id IS NOT NULL;

COMMENT ON COLUMN timed_challenge_sets.duration IS
  'Seconds allowed per question, not for the whole challenge. The admin field is labelled the same way and the student timer resets on each question.';

COMMENT ON COLUMN timed_challenge_sets.course_id IS
  'courses.mongo_id, matching flashcards.course_id. Not a uuid.';

COMMENT ON COLUMN timed_challenge_sets.questions IS
  'Array of { question, answers: text[], correctAnswer: text }. The student API maps correctAnswer to its index before the page sees it.';

COMMENT ON TABLE timed_challenges IS
  'Superseded by timed_challenge_sets, which carries a whole challenge in one row. Empty, kept only so an old reference does not error. Safe to drop once nothing mentions it.';

-- Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'timed_challenge_sets' ORDER BY ordinal_position;
