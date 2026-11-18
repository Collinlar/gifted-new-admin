# Exam candidate corrections and timeout answer recovery

Apply `exam_candidate_corrections.sql` after `exam_disqualified_review.sql` and
`certificates.sql`, then deploy the admin application. The migration is safe to
run again.

## Admin corrections

Open Exam mode, open a sitting, select a candidate, then choose **Correct name,
school or grade**. A reason is required. The correction changes the candidate's
exam record and therefore updates results, exports, transcripts and future
certificates. It does not change the linked Gifted account or the source
registration.

The audit stores the administrator, reason, and before/after values. If the
candidate already has an active certificate, the correction atomically revokes
the old serial and issues a corrected certificate linked to it. If replacement
cannot be issued, the entire correction is rolled back so the existing
certificate is not left revoked without a replacement.

## Timeout scoring and reset boundaries

Timeout submission continues to award one mark for each correct answer, zero for
blank or incorrect answers, and uses the full question count as the denominator.
Before scoring, it reconstructs the latest server-recorded answer for each
question from changes made since the current attempt started. This repairs a
lost/stale answer snapshot without accepting a late browser payload after time
has elapsed.

Resetting a candidate begins a new attempt. Earlier answer-history rows remain
for audit evidence, but the transcript and timeout scorer exclude anything dated
before the new `started_at`. This matters for the reported screenshot: its answer
changes were dated October 20 while the displayed attempt started November 13,
so those changes belonged to an earlier attempt and must not be awarded to the
November attempt.

## Verification

- `node tests/exam-candidate-corrections-db.mjs`
- `node tests/exam-timeout-results-db.mjs`
- `node tests/exam-disqualified-review-db.mjs`
- `npx tsc --noEmit`
- `node node_modules/next/dist/bin/next build --webpack`
