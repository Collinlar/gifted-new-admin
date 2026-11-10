# Paper results rollout

Apply `exam_paper_results.sql` **last**, after `exam_mode.sql`, `exam_mode_v2.sql`,
`certificates.sql`, and `exam_results_images.sql` (and existing repair migrations).
It is transactional and rerunnable. It replaces the candidate login function,
preserving the online image breakdown while suppressing it for paper totals.
Reapply it if an older migration replaces that login function later.

Deploy the admin and student frontends after the migration. No migration is
automatically applied by the app build. Account registration/claiming is a later phase;
the existing nullable `user_id` and candidate UUID are preserved for that work.

## Administrator workflow

Open a sitting, choose **Import paper results**, download the template or upload
an Excel/CSV file, select a worksheet, and match columns. Candidate reference,
full name, marks earned and maximum marks are required. School and grade are
optional. References are trimmed and case-insensitive within a sitting; keep them
as text in spreadsheets to preserve leading zeros. Maximum marks need not equal
the online question count: eligibility uses the same percentage rules for both.

Review all rows before importing. Identical references and values are skipped.
Changed values require the corrections checkbox and a written reason. Online
candidate access codes cannot be overwritten. A same-name match requires review:
use the existing reference for the same person, or confirm a different person.
The importer never merges by name or attaches a Gifted account automatically.

Withdraw published results before adding or correcting records. Withdraw any
active certificate for a corrected candidate first. After import, publish the
combined results and issue/reissue certificates using the sitting's settings.
The `on_submit` setting issues eligible certificates during import; `on_publish`
issues on publication; manual mode uses the existing certificate panel.
Existing rounded-percentage band rules are intentionally unchanged.

Use the source filter, export, candidate details, and audit tab for reconciliation.
Print slips to give paper candidates private credentials for the existing exam
link. They can sign in to collect published results/certificates even after the
sitting closes. Their recorded timestamp is the import time, not an invented
exam completion time. Paper records have no online answer history.

## Integrity

The API authenticates administrators and derives the actor from their token.
The RPC is service-role-only and independently validates every row. Review does
not write data. Commit locks the sitting and roster, checks a review fingerprint,
revalidates, and writes the entire batch or nothing. A stale review must be run
again. Repeating a successful upload cannot increase the participant count.
Corrections retain before/after values in the audit; batches retain actor,
filename, reason and counts. Imported scores support two decimal places.

Online reset/start/re-score operations cannot turn a paper record into an online
attempt. The UI offers paper correction through import and existing removal
controls. Paper candidates remain part of the normal submitted count.

## Verification

Run `node --test tests/paper-results.test.cjs` for parser/validation tests.
The database integration suite uses a disposable PGlite runtime:

```sh
npm install --prefix .tmp-paper-tests --no-save --package-lock=false @electric-sql/pglite
node tests/paper-results-db.mjs
```

The suite loads the actual migrations into a fresh database and checks imports,
retries, conflicts, rollback, publication, certificates, and result access.
The test runtime uses PostgreSQL's pgcrypto extension, as production does.
No production database is contacted by this suite.
