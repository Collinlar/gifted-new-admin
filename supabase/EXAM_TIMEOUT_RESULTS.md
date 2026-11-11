# Timed-out attempts and result inclusion

Run **all** of `exam_timeout_results.sql` (or its identical `.txt` copy) after
`exam_account_claims.sql`. Run through the final `COMMIT;`, not a selected fragment.
Deploy the admin and student changes together when no sitting is actively being
written: the new runner saves after each answer rather than relying only on the
older 15-second autosave. Do not rerun older function migrations afterwards.

## Grading and completion

- The server decides expiry using the candidate's `expires_at`, respecting the
  sitting's paused clock. A client-provided `auto` flag does not decide expiry.
- At expiry, saved answers are scored against the full paper. Unanswered and
  incorrect questions receive zero. An entirely blank attempt receives 0/N.
- The record becomes `submitted`, with `timed_out=true`. Expiry is not misconduct
  or disqualification. Deliberately stopped/disqualified attempts remain stopped.
- Late submissions cannot replace saved answers. Work that never reached the
  server cannot be recovered or graded. The updated runner saves each selection,
  serializes saves, retries periodically and displays failed-save feedback.
- Completion is idempotent. Retained session tokens can acknowledge completion,
  but cannot change answers or trigger post-completion tab-switch penalties.
- Historical `auto_submit` events for the current submitted attempt are labelled
  timed out without changing their existing grades. Unfinished expired attempts
  are finalized using the current saved answers when the sweep next runs.

## When scoring runs

Expiry is checked on candidate save, submit, heartbeat, paper retrieval, returning
login, claim and linked-account result access. The admin sitting list/detail also
sweeps expired attempts before returning the roster, including on auto-refresh.
Publishing results finalizes expired attempts in the same database transaction.

For unattended completion with all browsers closed, enable **Supabase Cron**
before applying the migration. If `pg_cron` is enabled, the migration schedules
`gifted-exam-timeouts` every minute. If it is not enabled, no job is installed;
completion happens on the next candidate/admin access or publication instead.
After enabling Cron later, rerun the migration to install the job.
See [Supabase Cron installation](https://supabase.com/docs/guides/cron/install)
and [scheduling SQL jobs](https://supabase.com/docs/guides/cron/quickstart).

The scheduler itself is not exercised by the local PGlite integration suite;
its scoring function is. Confirm the job in `cron.job` on the deployed database.

## Administrator decisions

Timed-out scores are **included by default**, matching previous automatic-submit
behaviour. Filter the sitting roster by **Time elapsed**, open a candidate and
choose **Exclude timed-out result** or **Include timed-out result**. Both require
a reason and record the actor, time and decision in the audit log.

Exclusion keeps the candidate and marks in the admin roster and participation
totals. It hides marks/breakdown from the candidate portal and My Exams, excludes
the row from **Export results**, and revokes any active certificate. The student
sees that their administrator excluded the attempt; the private decision reason
is not disclosed. Every certificate issuance path also rejects excluded records.

Re-inclusion restores result eligibility and applies the sitting's existing
automatic certificate mode. Manual certificate mode still needs manual issuance.
Excluding an already-published result takes effect on subsequent reads. Previously
downloaded documents cannot be recalled; certificate verification reflects their
revocation. Unrelated paper results and ordinary completed attempts are unchanged.

**Export roster** includes all filtered candidates, scores and inclusion flags
for reconciliation. **Export results** includes only submitted, included rows
from the current filters and excludes exam login credentials.

## Verification

Run `node tests/exam-timeout-results-db.mjs` from gifted-admin with the disposable
PGlite runtime used by the existing exam tests. It loads the real migrations and
tests partial/blank scoring, expired browser-independent attempts, manual submit,
late-payload rejection, repeated completion, pause/resume, candidate entry paths,
publication, inclusion/exclusion, certificate revocation/reissue and RPC access.
No production database is contacted.

The previously identified browser-exposed service-role key remains the separate
security repair requested by the user; this migration does not remediate it.
