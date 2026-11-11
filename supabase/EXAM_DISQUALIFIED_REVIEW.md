# Disqualified attempt review scores

Apply **all** of `exam_disqualified_review.sql` after `exam_timeout_results.sql`,
through the final `COMMIT;`. An identical `.txt` copy is supplied for the SQL
editor. Deploy the admin app to show the review labels. No new student deployment
is required beyond the preceding timeout update.

When an attempt becomes disqualified, a database trigger scores its saved online
answers against the full question count. Wrong and unanswered questions earn
zero. Blank attempts receive 0/N. This covers automatic tab-switch stops and
manual administrator stops, including future calls through existing functions.
It does not use unsaved browser answers.

The migration also scores historical disqualified attempts. For those records,
the available saved answers and current paper are used; edits to a paper since
the original sitting cannot be reconstructed. Existing completed scores and
paper-based marks are retained rather than recalculated. Reapplying the migration
does not overwrite a recorded review score.

The candidate remains **disqualified** and is forced to **excluded**. No submission
timestamp is invented. The exam token is cleared, scores/answers are frozen while
disqualified, and any active certificate is revoked. Result publication, account
reads, certificate issuance and the included-results export do not expose this
review score. The roster export retains it with `review_only` and timestamp fields.

In Exam Mode, select the sitting's **Stopped** filter and open a candidate. The
score, transcript, tab switches and audit history remain available to administrators.
The new score is labelled **Review score**, not an approved result.

Reinstatement is still a separate existing invigilator action requiring a reason.
Resuming an unfinished attempt clears the provisional score so eventual submission
is graded normally. An existing pre-stop result-inclusion decision is restored;
resetting an attempt starts clean. The review score remains in the audit history.
This feature does not add an override that publishes a still-disqualified attempt.

Validation: `node tests/exam-disqualified-review-db.mjs` exercises automatic and
manual stops, historical backfill, blank/partial scoring, exclusion, certificate
revocation, unchanged paper marks, reinstatement, reset and repeated migration.
It uses the existing disposable PGlite runtime and never contacts production.
