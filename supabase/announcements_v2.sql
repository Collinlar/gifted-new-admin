-- Upgrade announcements table to support typed, targeted, actionable announcements

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS type            text        DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS content_id      text,
  ADD COLUMN IF NOT EXISTS target_grades   text[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS target_tracks   text[]      DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS expires_at      timestamptz,
  ADD COLUMN IF NOT EXISTS is_pinned       boolean     DEFAULT false;

-- Per-user dismissal tracking (pinned announcements are never dismissed)
CREATE TABLE IF NOT EXISTS user_announcement_dismissals (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  announcement_id uuid        NOT NULL,
  dismissed_at    timestamptz DEFAULT now(),
  UNIQUE(user_id, announcement_id)
);
