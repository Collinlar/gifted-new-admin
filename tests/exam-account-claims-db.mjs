import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';

const db = new PGlite({ extensions: { pgcrypto } });
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const asUser = async id => {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [id || '']);
  await db.exec('SET ROLE authenticated');
};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY DEFAULT gen_random_uuid());
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE exams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, questions jsonb);`);
  for (const file of ['exam_mode.sql','exam_mode_v2.sql','certificates.sql','exam_results_images.sql','exam_paper_results.sql','exam_account_claims.sql','exam_account_claims.sql']) {
    await db.exec(await readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
  }
  console.log('PASS claim migration applies and reruns');
  const userA = (await scalar('INSERT INTO auth.users DEFAULT VALUES RETURNING id')).id;
  const userB = (await scalar('INSERT INTO auth.users DEFAULT VALUES RETURNING id')).id;
  const limitedUser = (await scalar('INSERT INTO auth.users DEFAULT VALUES RETURNING id')).id;
  const exam = (await scalar(`INSERT INTO exams(title,questions) VALUES ('Maths','[{"question":"1+1","correctAnswer":"2","image":"diagram.png","explanation":"Add one and one"}]') RETURNING id`)).id;
  const sitting = (await scalar(`INSERT INTO exam_sessions(exam_id,title,session_code,status) VALUES ($1,'Mixed sitting','CLAIM','closed') RETURNING id`, [exam])).id;
  const rows = [{ reference: 'P001', fullName: 'Paper Candidate', school: 'A', grade: '6', score: '72', maximum: '100' }];
  const preview = (await scalar(`SELECT admin_import_paper_results($1,$2::jsonb,'admin') AS r`, [sitting, JSON.stringify(rows)])).r;
  await db.query(`SELECT admin_import_paper_results($1,$2::jsonb,'admin','paper.xlsx',true,$3)`, [sitting, JSON.stringify(rows), preview.review]);
  const paper = await scalar(`SELECT * FROM exam_candidates WHERE entry_source='paper'`);
  await db.query(`SELECT admin_generate_candidates($1,'[{"full_name":"Online Candidate"},{"full_name":"Unfinished"}]')`, [sitting]);
  const online = await scalar(`SELECT * FROM exam_candidates WHERE full_name='Online Candidate'`);
  const pending = await scalar(`SELECT * FROM exam_candidates WHERE full_name='Unfinished'`);
  await db.query(`UPDATE exam_candidates SET status='submitted',submitted_at=now(),score=1,total_questions=1,answers='{"0":"2"}',question_order=ARRAY[0] WHERE id=$1`, [online.id]);
  const claim = async (c, password = c.password_plain) => (await scalar(`SELECT exam_claim_result('claim',$1,$2) AS r`, [c.access_code, password])).r;
  const myExams = async () => (await scalar(`SELECT exam_my_results() AS r`)).r;
  const detail = async id => (await scalar(`SELECT exam_my_result($1) AS r`, [id])).r;

  await asUser(null);
  assert.ok((await claim(paper)).error);
  assert.ok((await myExams()).error);
  await db.exec('RESET ROLE; SET ROLE anon');
  await assert.rejects(claim(paper), /permission denied/);
  await db.exec('RESET ROLE');
  await asUser(userA);
  assert.ok((await claim(paper, null)).error);
  assert.ok((await claim(paper, 'wrong')).error);
  assert.ok((await claim(pending)).error);
  const linked = await claim(paper);
  assert.equal(linked.linked, true); assert.equal(linked.alreadyLinked, false);
  assert.equal(linked.exam.resultsOut, false); assert.equal(linked.exam.score, null);
  assert.equal(linked.exam.total, null); assert.deepEqual(linked.exam.breakdown, []);
  assert.equal((await claim(paper)).alreadyLinked, true);
  assert.equal((await myExams()).exams.length, 1);
  await assert.rejects(db.query('SELECT * FROM exam_candidates'), /permission denied/);
  await assert.rejects(db.query('SELECT _exam_account_result($1,true)', [online.id]), /permission denied/);
  assert.ok((await detail(online.id)).error);
  console.log('PASS authenticated ownership, credential validation, completed-only claiming and pre-publication privacy');

  await asUser(userB);
  assert.ok((await claim(paper)).error);
  assert.equal((await myExams()).exams.length, 0);
  assert.ok((await detail(paper.id)).error);
  assert.equal((await claim(online)).linked, true);
  await db.exec('RESET ROLE');
  assert.equal(Number((await scalar('SELECT count(*) AS n FROM exam_candidates')).n), 3);
  assert.equal(Number((await scalar(`SELECT count(*) AS n FROM exam_audit_log WHERE action='candidate.claim_account'`)).n), 2);
  const after = await scalar('SELECT * FROM exam_candidates WHERE id=$1', [paper.id]);
  for (const field of ['id','session_id','score','total_questions','full_name','entry_source','candidate_reference']) assert.equal(after[field], paper[field]);
  console.log('PASS competing-account claim cannot overwrite owner, repeated claims are idempotent, candidate count and marks unchanged');

  const template = (await scalar(`INSERT INTO certificate_templates(name) VALUES ('Pass') RETURNING id`)).id;
  await db.query(`UPDATE exam_sessions SET certificate_mode='on_publish',certificate_bands=$2::jsonb,results_show_breakdown=true,results_published_at=now() WHERE id=$1`,
    [sitting, JSON.stringify([{ minPercent: 50, templateId: template, band: 'Pass' }])]);
  const paperCert = await scalar('SELECT * FROM certificates WHERE candidate_id=$1', [paper.id]);
  await asUser(userA);
  const paperResult = await detail(paper.id);
  assert.equal(paperResult.score, 72); assert.equal(paperResult.showBreakdown, false);
  assert.deepEqual(paperResult.breakdown, []); assert.equal(paperResult.certificate.serial, paperCert.serial);
  await asUser(userB);
  const onlineResult = await detail(online.id);
  assert.equal(onlineResult.score, 1); assert.equal(onlineResult.showBreakdown, true);
  assert.equal(onlineResult.breakdown[0].image, 'diagram.png');
  await db.exec('RESET ROLE');
  await db.query('UPDATE exam_sessions SET results_published_at=NULL WHERE id=$1', [sitting]);
  await asUser(userA);
  const hidden = await detail(paper.id);
  assert.equal(hidden.score, null); assert.equal(hidden.total, null); assert.equal(hidden.resultsOut, false);
  assert.ok(hidden.certificate, 'independently issued certificates remain available');
  await db.exec('RESET ROLE');
  await db.query('UPDATE certificates SET revoked_at=now() WHERE id=$1', [paperCert.id]);
  await asUser(userA); assert.equal((await detail(paper.id)).certificate, null);
  console.log('PASS publication gates marks/breakdown and certificate revocation is reflected in account reads');

  await asUser(limitedUser);
  for (let i = 0; i < 10; i++) assert.ok((await claim(paper,'wrong')).error);
  assert.match((await claim(paper)).error, /Too many/);
  await db.exec('RESET ROLE');
  await db.query(`UPDATE exam_claim_limits SET window_started=now()-interval '16 minutes' WHERE user_id=$1`, [limitedUser]);
  await asUser(limitedUser);
  assert.match((await claim(paper)).error, /already linked/);
  await assert.rejects(db.query(`SELECT admin_unlink_exam_account($1,'forged','take over')`, [paper.id]), /permission denied/);
  await db.exec('RESET ROLE');
  await assert.rejects(db.query(`SELECT admin_unlink_exam_account($1,'admin','')`, [paper.id]), /reason/);
  await db.query(`SELECT admin_unlink_exam_account($1,'admin','Verified mistaken account')`, [paper.id]);
  const rotated = await scalar('SELECT * FROM exam_candidates WHERE id=$1', [paper.id]);
  assert.equal(rotated.user_id, null); assert.notEqual(rotated.password_plain, paper.password_plain);
  await asUser(userA); assert.ok((await detail(paper.id)).error); assert.ok((await claim(paper)).error);
  await asUser(userB); assert.equal((await claim(rotated)).linked, true);
  console.log('PASS failed-attempt throttling, admin-only recovery, password rotation and rightful re-claim');

  await db.exec('RESET ROLE');
  await db.query(`UPDATE exam_candidates SET status='disqualified' WHERE id=$1`, [online.id]);
  await asUser(userB);
  const stopped = await detail(online.id);
  assert.equal(stopped.status, 'disqualified'); assert.equal(stopped.score, null); assert.equal(stopped.certificate, null);
  await db.exec('RESET ROLE');
  await db.query('DELETE FROM auth.users WHERE id=$1', [userB]);
  await asUser(userB); assert.ok((await myExams()).error); assert.ok((await detail(paper.id)).error);
  console.log('PASS stopped attempts do not reveal marks/certificates and deleted accounts cannot read records');
} finally { await db.close(); }
