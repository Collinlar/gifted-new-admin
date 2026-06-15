-- Add publish and featured management columns to flashcards table
ALTER TABLE flashcards
  ADD COLUMN IF NOT EXISTS publish  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured boolean DEFAULT false;

-- Index for common admin filter patterns
CREATE INDEX IF NOT EXISTS idx_flashcards_publish  ON flashcards(publish);
CREATE INDEX IF NOT EXISTS idx_flashcards_featured ON flashcards(featured);
