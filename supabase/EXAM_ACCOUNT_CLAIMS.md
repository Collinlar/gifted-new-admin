# Exam account claiming

## Rollout

1. Run **all** of `exam_account_claims.sql` after the paper-results migration.
   It begins with `BEGIN;` and ends with `COMMIT;`. The identical `.txt` copy is
   provided for copying into the Supabase SQL editor. Do not run a partial selection.
2. Deploy the admin and student app updates. The build does not apply SQL.
3. Test with one paper candidate and one online candidate using separate accounts.

This migration is transactional and rerunnable. It adds account-link metadata,
claim throttling, authenticated result functions, and an admin recovery function.
Existing exam rows, scores, paper imports, certificate identities and pre-existing
`user_id` links remain intact. It does not replace the existing exam login function.

## Candidate journey

Candidates see **Save this exam to my account** after submitting an online exam
and when viewing published results/certificates. The exam entry page also links
to this flow, including while results are still unpublished. Paper candidates use
the same sitting link and their printed credentials.

The **My Exams** page offers sign-in or signup. Both return to the same sitting's
claim form. Only the public sitting code is passed through URLs; the exam access
code and password are entered after sign-in and never saved by this feature to
browser storage or URL parameters. The destination account email is displayed,
with an option to sign in to a different account.

After verifying the slip, the existing candidate record is attached to the
authenticated account. Matching by name, email, school or grade is never used
as proof. Repeating a claim on the same account succeeds without a duplicate
record or duplicate audit entry. A different account cannot take over the link.
Only submitted exams can be newly claimed. Existing linked candidates can see
their standing while a pending or stopped record has no marks/certificate shown.

My Exams lists both online and paper-based records. Published marks, permitted
online question breakdowns, and active certificates are fetched fresh through
ownership-checked functions. Withdrawing results hides marks and answers;
revoking a certificate removes it from account responses. Independently issued
certificates remain available even if marks have not been published, matching
the existing exam portal's behaviour.

## Administrator recovery

The sitting roster shows whether an account is linked; candidate details show
the account UUID and linking timestamp. Export includes link status and date.
After independently checking a mistaken claim, use **Remove Gifted account link**
and give a reason. This removes ownership, rotates the exam password and clears
the exam token. Print a fresh slip for the rightful candidate, who must sign in
and claim it. The old password cannot reclaim the exam.

Scores and certificates are not recreated or changed. A downloaded certificate
cannot be recalled by unlinking an account; use the existing certificate
revocation controls if a certificate itself needs to be withdrawn.

## Permissions and remaining security work

The claim/list/detail RPCs are authenticated-only and derive identity from
`auth.uid()`. Direct table access and the internal result helper are not granted
to candidates. Claims lock the candidate row; failed credentials are limited to
10 failures per account per 15-minute window. Administrators recover links via
the authenticated admin API, using a service-role-only RPC with actor and reason.

**Existing app-wide security issue, explicitly deferred by the user:**
`gifted-project/src/lib/supabaseAdmin.js` references a configured
`VITE_SUPABASE_SERVICE_ROLE` in browser code. A service-role credential bypasses
database restrictions, including this feature's ownership controls. The new
exam flow never imports that client, but the wider app still does. Remove its
browser exposure, migrate privileged operations server-side, and rotate the
exposed key as a separate security repair. Until that is done, the app-wide
account security boundary must not be considered protected in production.

## Validation

From gifted-admin, using the disposable runtime already used for paper import:

```sh
node tests/exam-account-claims-db.mjs
```

Tests run the actual migrations with pgcrypto and exercise authenticated role
permissions, missing/wrong credentials, ownership isolation, repeat claims,
publication gating, certificate revocation, paper/online breakdowns, throttling,
admin unlinking and credential rotation. Supabase's `auth.uid()` is represented
by the equivalent test JWT subject setting against a disposable auth user table.
No production database is contacted.

From gifted-project:

```sh
node --test tests/exam-account-links.test.mjs
npm run build
```
