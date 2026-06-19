-- Extend flashcards with track, grade, and subject metadata
-- Run after add_flashcard_columns.sql

ALTER TABLE flashcards
  ADD COLUMN IF NOT EXISTS track_id uuid REFERENCES tracks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS grade    text,
  ADD COLUMN IF NOT EXISTS subject  text;

CREATE INDEX IF NOT EXISTS idx_flashcards_track_id ON flashcards(track_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_grade    ON flashcards(grade);
CREATE INDEX IF NOT EXISTS idx_flashcards_subject  ON flashcards(subject);
