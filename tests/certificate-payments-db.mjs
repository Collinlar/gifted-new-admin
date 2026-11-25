import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';

const db = new PGlite({ extensions: { pgcrypto } });
const file = name => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE exams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, questions jsonb);`);
  for (const name of [
    'exam_mode.sql', 'exam_mode_v2.sql', 'certificates.sql', 'exam_pause_repair.sql',
    'exam_results_images.sql', 'exam_paper_results.sql', 'exam_account_claims.sql',
    'exam_timeout_results.sql', 'certificate_payments.sql', 'certificate_payments.sql',
  ]) await db.exec(await file(name));

  const exam = (await one(`INSERT INTO exams(title,questions) VALUES
    ('Certificate test','[{"question":"Q","correctAnswer":"A"}]') RETURNING id`)).id;
  const session = (await one(`INSERT INTO exam_sessions(exam_id,title,session_code,certificate_mode)
    VALUES($1,'Certificate sitting','CERTPAY','manual') RETURNING id`, [exam])).id;
  const template = (await one(`INSERT INTO certificate_templates(name) VALUES('Pass') RETURNING id`)).id;
  await db.query(`UPDATE exam_sessions SET certificate_bands=$2::jsonb WHERE id=$1`, [session,
    JSON.stringify([{ minPercent: 50, templateId: template, band: 'Pass' }])]);

  async function candidate(name) {
    await db.query(`SELECT admin_generate_candidates($1,$2::jsonb)`, [session, JSON.stringify([{ full_name: name }])]);
    return (await one(`UPDATE exam_candidates SET status='submitted',submitted_at=now(),score=1,total_questions=1
      WHERE session_id=$1 AND full_name=$2 RETURNING id`, [session, name])).id;
  }
  const free = await candidate('Free Candidate');
  let result = (await one(`SELECT _cert_issue($1,'admin') r`, [free])).r;
  assert.equal(result.issued, true);

  await db.query(`UPDATE exam_sessions SET certificate_access_policy='separate',certificate_fee_amount=25 WHERE id=$1`, [session]);
  const paid = await candidate('Paid Candidate');
  result = (await one(`SELECT _cert_issue($1,'admin') r`, [paid])).r;
  assert.equal(result.issued, false);
  assert.match(result.reason, /fee/i);
  await db.query(`SELECT admin_set_certificate_entitlements($1,$2,'paid','admin','MOMO-1',NULL,25)`, [session, [paid]]);
  assert.equal((await one(`SELECT _cert_issue($1,'admin') r`, [paid])).r.issued, true);

  const waived = await candidate('Waived Candidate');
  await db.query(`SELECT admin_set_certificate_entitlements($1,$2,'waived','admin',NULL,'Sponsored',NULL)`, [session, [waived]]);
  assert.equal((await one(`SELECT _cert_issue($1,'admin') r`, [waived])).r.issued, true);

  const refunded = await candidate('Refunded Candidate');
  await db.query(`SELECT admin_set_certificate_entitlements($1,$2,'paid','admin','MOMO-2',NULL,25)`, [session, [refunded]]);
  await db.query(`SELECT admin_set_certificate_entitlements($1,$2,'refunded','admin',NULL,'Payment returned',NULL)`, [session, [refunded]]);
  assert.equal((await one(`SELECT _cert_issue($1,'admin') r`, [refunded])).r.issued, false);

  await db.query(`UPDATE exam_sessions SET certificate_access_policy='manual' WHERE id=$1`, [session]);
  const approved = await candidate('Approved Candidate');
  await db.query(`SELECT admin_set_certificate_entitlements($1,$2,'approved','admin',NULL,'Board approved',NULL)`, [session, [approved]]);
  assert.equal((await one(`SELECT _cert_issue($1,'admin') r`, [approved])).r.issued, true);

  await db.query(`UPDATE exam_sessions SET certificate_access_policy='separate',certificate_mode='on_publish',
    results_published_at=now() WHERE id=$1`, [session]);
  const late = await candidate('Paid After Publication');
  result = (await one(`SELECT admin_set_certificate_entitlements($1,$2,'paid','admin','MOMO-3',NULL,25) r`, [session, [late]])).r;
  assert.equal(result.issued, 1);
  const account = (await one(`SELECT _exam_account_result($1,false) r`, [late])).r;
  assert.equal(account.certificateAccess.status, 'paid');
  assert.ok(account.certificate);

  const permissions = await one(`SELECT
    has_function_privilege('anon','admin_set_certificate_entitlements(uuid,uuid[],text,text,text,text,numeric)','EXECUTE') anon,
    has_function_privilege('authenticated','admin_set_certificate_entitlements(uuid,uuid[],text,text,text,text,numeric)','EXECUTE') authenticated`);
  assert.deepEqual(permissions, { anon: false, authenticated: false });
  assert.ok(Number((await one(`SELECT count(*) n FROM exam_audit_log WHERE action='certificate.entitlement'`)).n) >= 6);
  console.log('PASS certificate policy gates, payment, waiver, refund, manual approval, late automatic issuance, learner state, rerun and permissions.');
} finally {
  await db.close();
}
