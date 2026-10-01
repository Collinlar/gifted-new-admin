-- ═══════════════════════════════════════════════════════════════════════════
-- GRADES — one system, an integer 1 to 12, from signup to filtering
--
-- Run once. Additive and reversible: the original string is kept verbatim in
-- users.grade_legacy and nothing is deleted.
--
-- Content was always numeric. exams.grade is an integer[] of 1 to 12 and
-- courses.grade holds "1" to "12". The users table had drifted into five
-- formats in one column, so 1,045 students matched no content at all and
-- 5,476 of 6,228 could not be reached by a targeted announcement. The signup
-- form was making it worse: it offered JHS 1 to SHS 3, which matched nothing.
--
-- THE MAPPING BELOW IS NOT A PARSER. It is the exact output of the parser in
-- gifted-project/src/lib/grades.js, run over every distinct value in this
-- table and checked by hand. It is written out in full so the conversion can
-- be read and audited rather than trusted.
--
-- The reason it is not a parser: the obvious rule, "take the first number in
-- the string", is wrong. SHS 3 is Grade 12, not Grade 3. That rule would
-- silently move 46 secondary students into primary school:
--
--     'SHS 3' -> 12   not 3      19 users
--     'JHS 1' ->  7   not 1       9 users
--     'SHS 2' -> 11   not 2       9 users
--     'SHS 1' -> 10   not 1       4 users
--     'JHS 3' ->  9   not 3       3 users
--     'JHS 2' ->  8   not 2       1 user
--
-- 6,179 users convert. 5,086 keep a null grade and are asked once on next
-- sign in. A null grade means unfiltered content, so they see more rather
-- than an empty page while they wait.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Keep every original string, exactly as it was
ALTER TABLE users ADD COLUMN IF NOT EXISTS grade_legacy text;
UPDATE users SET grade_legacy = grade WHERE grade_legacy IS NULL;

-- 2. Convert.
--
--    A CASE rather than a lookup table because PostgreSQL rejects a subquery
--    inside ALTER COLUMN ... USING with "cannot use subquery in transform
--    expression". A plain expression is allowed, so the mapping is written
--    out as one.
--
--    Keys are normalised before matching: a non-breaking space becomes a
--    space, then trimmed. One user had 'Basic' + U+00A0 + '7', which is
--    invisible in a diff and would not survive a copy and paste.
--
--    Anything not listed becomes null on purpose. Those are people's names,
--    'Level 400', 'Junior College (AS, A-Level)', '10-12' and two empty
--    strings. Guessing at them would be worse than asking.
ALTER TABLE users
  ALTER COLUMN grade TYPE integer
  USING (CASE btrim(replace(grade, chr(160), ' '))
    WHEN 'Grade 12' THEN 12                         -- 1529 users
    WHEN 'Grade 11' THEN 11                         -- 1353 users
    WHEN 'Grade 10' THEN 10                         -- 656 users
    WHEN 'Grade 9' THEN 9                           -- 376 users
    WHEN 'Grade 12 (SHS 3)' THEN 12                 -- 370 users
    WHEN 'Grade 8' THEN 8                           -- 274 users
    WHEN 'Grade 7' THEN 7                           -- 241 users
    WHEN '6' THEN 6                                 -- 176 users
    WHEN 'Grade 11 (SHS 2)' THEN 11                 -- 157 users
    WHEN 'Grade 10 (SHS 1)' THEN 10                 -- 122 users
    WHEN '5' THEN 5                                 -- 116 users
    WHEN '4' THEN 4                                 -- 86 users
    WHEN 'Grade 9 (JHS 3)' THEN 9                   -- 68 users
    WHEN 'Grade 7 (JHS 1)' THEN 7                   -- 68 users
    WHEN '10' THEN 10                               -- 63 users
    WHEN '3' THEN 3                                 -- 50 users
    WHEN '8' THEN 8                                 -- 50 users
    WHEN '7' THEN 7                                 -- 45 users
    WHEN '12' THEN 12                               -- 41 users
    WHEN '9' THEN 9                                 -- 39 users
    WHEN '11' THEN 11                               -- 35 users
    WHEN 'Grade 8 (JHS 2)' THEN 8                   -- 35 users
    WHEN '2' THEN 2                                 -- 34 users
    WHEN 'Grade 6 (Class 6)' THEN 6                 -- 30 users
    WHEN 'Grade 4 (Class 4)' THEN 4                 -- 28 users
    WHEN 'Grade 5 (Class 5)' THEN 5                 -- 23 users
    WHEN 'Grade 1 (Class 1)' THEN 1                 -- 20 users
    WHEN 'SHS 3' THEN 12                            -- 19 users
    WHEN '1' THEN 1                                 -- 17 users
    WHEN 'Grade 3 (Class 3)' THEN 3                 -- 14 users
    WHEN 'Grade 2 (Class 2)' THEN 2                 -- 13 users
    WHEN 'JHS 1' THEN 7                             -- 9 users
    WHEN 'SHS 2' THEN 11                            -- 9 users
    WHEN 'SHS 1' THEN 10                            -- 4 users
    WHEN 'Basic 7' THEN 7                           -- 3 users
    WHEN 'JHS 3' THEN 9                             -- 3 users
    WHEN 'Grade 4' THEN 4                           -- 1 user
    WHEN 'grade 4' THEN 4                           -- 1 user
    WHEN 'JHS 2' THEN 8                             -- 1 user
    ELSE NULL
  END);

-- 4. The database refuses the next bad value, which is the point of moving
--    to an integer rather than just tidying the strings.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_grade_range;
ALTER TABLE users ADD CONSTRAINT users_grade_range
  CHECK (grade IS NULL OR (grade BETWEEN 1 AND 12));

COMMIT;

-- Verify:
--   SELECT count(*) FILTER (WHERE grade IS NOT NULL) AS converted,
--          count(*) FILTER (WHERE grade IS NULL)     AS to_be_asked,
--          count(*) AS total
--     FROM users;
--   -- expect converted 6179, to_be_asked 5086, total 11265
--
--   SELECT grade_legacy, grade, count(*) FROM users
--    WHERE grade_legacy ~* '^(jhs|shs)' GROUP BY 1,2 ORDER BY 1;
--   -- expect 'SHS 3' -> 12, 'JHS 1' -> 7, never 3 or 1
--
-- To undo:
--   ALTER TABLE users DROP CONSTRAINT users_grade_range;
--   ALTER TABLE users ALTER COLUMN grade TYPE text USING grade_legacy;
