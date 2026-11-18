# Add exam candidates from registrations

Apply `exam_registration_candidates.sql` to the same Supabase database used by
the admin app before deploying the updated admin code. It requires the existing
registration guest migration (`registrations_v4.sql` or later) and exam audit
migration (`exam_mode_v2.sql` or later). The migration is safe to run again.

In Exam mode, open a sitting and choose **Add candidates → From registrations**.
Choose a registration form, filter by registration status, payment status, grade,
or name/school, select participants, then add them. Filters clear the selection
to avoid adding hidden participants. Up to 1000 registrations can be added per
request. Credentials are available through the existing candidate list and slips.

Both individual and imported submissions are supported, including guests without
emails or accounts. Draft, rejected, withdrawn, and unnamed registrations are
shown but cannot be selected. Payment is an admin-controlled filter, not an
automatic eligibility rule. Closed sittings reject additions.

Each candidate stores the source registration ID. A database unique index and a
sitting lock prevent repeat additions of that registration to the same sitting.
Repeating a request skips existing candidates without changing their credentials
or attempts. The same registration can be added to another sitting. This does not
identify duplicates that were previously entered manually or uploaded separately,
or separate guest registrations belonging to the same person.

The server reads participant identity from saved registration answers and profile
data, rechecks eligibility at addition time, and creates credentials atomically.
An invalid selection rolls back the batch. Later edits to registrations do not
automatically change exam candidates. Each addition is recorded in the exam audit.

Validation: `node tests/exam-registration-candidates-db.mjs` uses the project's
existing local PGlite test runtime in `.tmp-paper-tests`. It checks schema reruns,
guest/account candidates, repeat protection, separate sittings, stale and invalid
selection rollback, closed sittings, audit events, and database permissions.
