# Diagnostics builder v1

Apply `diagnostics_v1.sql` to the same Supabase project used by this admin app, then open **Content > Diagnostics**. The migration is additive and transactional. It does not change exams, practice, track_items, or learner routes. Existing tracks are required.

## Included

- Separate admin builder, authenticated API, and database tables.
- Track-owned skills grouped by topic, reusable between diagnostic drafts.
- Text multiple-choice questions with 2–6 options when copied; manual entry and spreadsheet imports use four options.
- Independent copying of supported text questions from an existing assessment. Images and unrecognised answer formats are rejected without partial copying.
- CSV/XLSX import with all-or-nothing validation; download the template from the builder. Topics and skills must already exist and be selected.
- Draft saves, optimistic revision checks, server-side publication checks, and atomic publication of immutable snapshots including skill names and report-rule version.
- Browser-only learner/report preview. Preview answers are not learner attempts.

## Publication and interpretation

Each selected skill needs the configured minimum number of questions (at least three) and at least one at each difficulty. All questions need distinct options, a skill, and an explanation. Three questions is a configurable initial floor, not a claim of statistical reliability. Pilot the coverage and thresholds with educators before relying on readiness findings.

Reports distinguish insufficient evidence, mixed evidence needing verification, demonstrated strength, and development needs. Missing answers do not count as evidence of a misconception. Higher-difficulty correct answers alongside lower-difficulty wrong answers on the same skill trigger verification. Report suggestions describe next actions; they do not claim that matching learning resources have been assigned.

Published versions do not enrol learners by themselves. Saving edits preserves prior publications. Publication uses a row lock and expected revision so simultaneous edits cannot change the snapshot being published. Never modify a published version to fix content: publish a new version.

## Remaining integration

Learner delivery, durable attempts and reports, reusable skill-to-content mappings, and diagnostic-result journey routing are now provided by the later migrations below. Automatic completion from existing course/practice/assessment activity and administrator-authored competition-readiness thresholds remain follow-on work. AI authoring, misconception tags, rich mathematics/images, skill editing, and assessment-copy support for additional formats are not included in this slice.

The skills endpoint returns at most 1,000 skills per track and the library shows the 200 most recently updated diagnostics. Add pagination before these limits become relevant.

## Verification

Run `node --test tests/diagnostics.test.cjs` and `npx tsc --noEmit`. With the repository's existing PGlite test runtime installed under `.tmp-paper-tests`, run `node tests/diagnostics-db.mjs` to verify migration reruns, privileges, publication, immutable versions, and stale revision handling against a local PostgreSQL engine. After applying the migration, verify with an admin account:

1. Create a diagnostic, a topic/skill, and three questions spanning the levels. Save and reload.
2. Remove an explanation: draft saving should work but publication should be blocked.
3. Preview all correct, foundational-only correct, advanced-only correct, and unanswered scenarios.
4. Publish, edit the draft, and confirm the previous snapshot remains unchanged.
5. Open the same saved draft in two tabs; saving one should make saving the stale tab return a conflict.
6. Confirm requests without an admin token return 401 and anon/authenticated database roles cannot read answer keys.
7. Open existing assessments and practice to confirm their existing behaviour.

## Opt-in live smoke test

`node tests/diagnostics-live.cjs --write-qa-record` runs against a local admin server on port 3010 and its configured Supabase database. `DIAGNOSTICS_TEST_URL` can select another local port. Add `--in-process` to execute the real Next route handlers directly when local HTTP is unavailable. This alternate mode verifies the backend and database, not HTTP transport or the browser UI.

This test creates and retains one `[QA TEST]` diagnostic, one QA skill, and one immutable published version. It uses a synthetic administrator identity for the test audit trail, never a learner account. Do not run repeatedly unless those additional QA records are intended. It checks authentication, skill/draft persistence, validation, edit conflicts, publication, and snapshot isolation. It checks anonymous database access too when `NEXT_PUBLIC_SUPABASE_ANON_KEY` is configured.

## Learner flow

Apply `diagnostics_learner_v1.sql` after the first migration. It adds explicit learner assignments and version-bound attempts; publishing by itself does not expose a diagnostic. The admin builder can then assign its latest published version to an existing learner email. The learner's `/diagnostics` page supports saving, pausing, resuming, final submission, and reopening the saved report.

Before submission, the learner RPC strips correct answers and explanations. The database checks assignment ownership, answer indices, optimistic revisions, final-answer locking, and scores the report from the immutable published snapshot. Run `node tests/diagnostics-learner-db.mjs` to verify these guarantees locally.

## Gifted Experience journey

Apply `gifted_experience_v1.sql` after both diagnostics migrations. It adds a separate journey layer without changing assessments, quizzes, practice mode, Tracks, or diagnostic scoring. In **Content > Gifted Experiences**, an administrator can build an ordered track journey whose first stage is a published diagnostic, add internal learning/practice/assessment/mock/competition/camp destinations, publish an immutable version, and assign it to an existing learner account.

Assignment transactionally creates the matching diagnostic assignment. The learner's `/gifted-experience` page keeps the buffet available while presenting one current stage, locked future stages, durable progress, and completion links. A diagnostic stage advances only after its immutable attempt is submitted; other stages require an explicit learner completion action. Run `node --test tests/gifted-experience.test.cjs`, `node tests/gifted-experience-db.mjs`, and both application builds before applying the migration.

Apply `gifted_experience_routing_v2.sql` after `gifted_experience_v1.sql` to add result-driven routes and reusable skill-to-content mappings. An administrator can map a track skill and diagnostic outcome to tagged course, exam, competition, or camp content, expose it as a learner recommendation, and add it to a journey as a conditional stage. The learner route contains only the stages that apply to the immutable diagnostic report; existing v1 journeys remain linear because stages without conditions always apply.

Administrator-authored readiness thresholds, automatic completion signals from existing courses/practice/assessments, remediation loops, and competition-readiness rules remain follow-on work; they should extend this journey layer rather than the existing assessment module.
