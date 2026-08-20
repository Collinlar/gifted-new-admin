-- ═══════════════════════════════════════════════════════════════════════════
-- HOMEPAGE — the public page, editable without a deploy
--
-- Idempotent. Safe to run on a live install, and safe to run twice.
--
-- Why this exists
-- ---------------
-- Every word on the homepage lived in Home.jsx: six programmes, three steps,
-- three events, the stats, the phone number. Changing a closing date meant a
-- code change and a deploy, which is why the dates all still read "tbc".
--
-- The shape
-- ---------
-- One row per section. Each carries its published content and, separately, a
-- draft. The admin only ever edits the draft; publishing copies draft into
-- content for every section at once. That is what makes it safe to rewrite
-- the hero on Tuesday, add three events on Wednesday, and have the public
-- page change only when someone decides it should.
--
-- content is jsonb rather than columns because the sections genuinely differ:
-- the hero has a headline and two buttons, the programme list is a repeatable
-- array. Columns covering the union of those would be mostly null.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS homepage_sections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable identifier the page code looks up. Not renameable from the admin,
  -- because Home.jsx keys its layout off these.
  key         text UNIQUE NOT NULL,
  label       text NOT NULL,              -- what the admin sees in the list

  enabled     boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,

  content     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- live
  draft       jsonb,                                -- null means no unpublished edits

  updated_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

CREATE INDEX IF NOT EXISTS homepage_sections_order_idx ON homepage_sections(sort_order);

ALTER TABLE homepage_sections ENABLE ROW LEVEL SECURITY;

-- The homepage is public and is read before anyone signs in, so anon reads it.
-- The draft column rides along, which is acceptable here: it is unpublished
-- marketing copy on a public marketing page, not anybody's data. Nothing is
-- writable from a browser session; the admin server holds the only write path.
DROP POLICY IF EXISTS "homepage is public" ON homepage_sections;
CREATE POLICY "homepage is public"
  ON homepage_sections FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── Publishing ─────────────────────────────────────────────────────────────
--
-- One action for the whole page. Publishing section by section would let
-- someone ship a hero promising four programmes above a list showing six.

CREATE OR REPLACE FUNCTION publish_homepage()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
DECLARE moved integer;
BEGIN
  UPDATE homepage_sections
     SET content = draft,
         draft = NULL,
         published_at = now(),
         updated_at = now()
   WHERE draft IS NOT NULL;

  GET DIAGNOSTICS moved = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'sections', moved);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION publish_homepage() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION publish_homepage() TO service_role;

-- Throwing away unpublished edits and going back to what is live
CREATE OR REPLACE FUNCTION discard_homepage_draft()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, pg_temp
AS $fn$
BEGIN
  UPDATE homepage_sections SET draft = NULL, updated_at = now() WHERE draft IS NOT NULL;
  RETURN jsonb_build_object('ok', true);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION discard_homepage_draft() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION discard_homepage_draft() TO service_role;

-- ── Seed ───────────────────────────────────────────────────────────────────
--
-- Exactly what the page shows today, so running this migration changes
-- nothing visible. ON CONFLICT DO NOTHING means re-running it will never
-- overwrite whatever the team has since edited.

INSERT INTO homepage_sections (key, label, sort_order, content) VALUES

('brand', 'Site name and menu', 0, jsonb_build_object(
  'wordmark', 'Gifted',
  'kicker', 'Olympiad Edu Center',
  'nav', jsonb_build_array(
    jsonb_build_object('label', 'Programmes',   'target', '#programmes'),
    jsonb_build_object('label', 'How it works', 'target', '#steps'),
    jsonb_build_object('label', 'Dates',        'target', '#dates')
  ),
  'signInLabel', 'Sign in'
)),

('hero', 'Hero', 1, jsonb_build_object(
  'eyebrow', 'Accra · since 2019',
  -- Three lines rather than one string: the headline is set to break exactly
  -- where it is written, and a single field would leave that to the browser.
  'headline', jsonb_build_array(
    'Olympiad training,', 'taught by people', 'who have sat it.'
  ),
  'lede', 'Six programmes in maths, physics and computing — live coaching, timed papers and certification students can verify.',
  'primaryLabel',   'See open dates',
  'primaryTarget',  '#dates',
  'secondaryLabel', 'Student sign in',
  'secondaryTarget','/login'
)),

('programmes', 'Programmes', 2, jsonb_build_object(
  'heading', 'Programmes',
  'items', jsonb_build_array(
    jsonb_build_object('title','Mathematics Olympiad','meta','Ages 12–18','img','/math.jpg','target','/login',
      'line','Algebra, number theory, combinatorics and geometry, taught through past olympiad papers.'),
    jsonb_build_object('title','Physics Olympiad','meta','Ages 14–18','img','/stem.jpg','target','/login',
      'line','Mechanics and electromagnetism worked to competition depth, with lab-style problem sessions.'),
    jsonb_build_object('title','Informatics and Coding','meta','Ages 13–18','img','/eng_400x200.jpg','target','/login',
      'line','Algorithms, data structures and contest programming, graded on real judge problems.'),
    jsonb_build_object('title','STEM Bootcamp','meta','3 weeks','img','/2.jpg','target','/login',
      'line','A short, fast introduction across maths, physics and computing for students testing the water.'),
    jsonb_build_object('title','Pathways for Beginners','meta','Ages 10–14','img','/us.jpg','target','/login',
      'line','Foundations first: problem-solving habits, notation and confidence before competition work.'),
    jsonb_build_object('title','Exams and Certification','meta','Year-round','img','/math.jpg','target','/login',
      'line','Sit accredited assessments and receive a certificate that schools can verify by serial number.')
  )
)),

('proof', 'Numbers strip', 3, jsonb_build_object(
  'stats', jsonb_build_array(
    jsonb_build_object('value','12,000','label','Students on the platform'),
    jsonb_build_object('value','20+',   'label','Olympiads supported')
  ),
  'line', 'Coaching is run by former olympiad medallists and university faculty, built around the past papers and mark schemes students actually sit.'
)),

('steps', 'How it works', 4, jsonb_build_object(
  'kicker', 'How it works',
  'items', jsonb_build_array(
    jsonb_build_object('n','01','title','Choose a programme','body','Start on a beginner pathway or go straight to a subject olympiad track. A short diagnostic places you.'),
    jsonb_build_object('n','02','title','Train every week','body','Live coaching, timed problem sets and past papers, with your progress tracked against the syllabus.'),
    jsonb_build_object('n','03','title','Sit and certify','body','Register through the portal, sit the supervised exam, and get a certificate schools can verify by serial.')
  )
)),

('dates', 'What is open', 5, jsonb_build_object(
  'heading', 'What is open right now.',
  'note', 'Places are limited per cohort and close once a sitting is scheduled.',
  'ctaLabel', 'Register',
  'items', jsonb_build_array(
    jsonb_build_object('term','Term 3','name','National Mathematics Olympiad','what','Registration and paper selection for the national round.','when','closes · tbc','target','/sign-up'),
    jsonb_build_object('term','Term 3','name','Physics Olympiad, Round One','what','Supervised sitting at partner centres in Accra and Kumasi.','when','sits · tbc','target','/sign-up'),
    jsonb_build_object('term','Rolling','name','Beginner Pathway Intake','what','Weekly classes for students new to competition work.','when','begins · tbc','target','/sign-up')
  )
)),

('footer', 'Footer', 6, jsonb_build_object(
  'brand', 'Gifted',
  'email', 'programs@atdp.africa',
  'phone', '+233 20 185 6818',
  'address', 'East Legon, Accra, Ghana',
  'copyright', '© 2026 Olympiad Edu Center'
))

ON CONFLICT (key) DO NOTHING;

-- Verify: seven rows, all clean
--   SELECT key, label, enabled, sort_order, draft IS NULL AS clean
--     FROM homepage_sections ORDER BY sort_order;
