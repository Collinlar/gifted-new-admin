import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
const db=new PGlite({extensions:{pgcrypto}});
const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
const migration=await readFile(new URL('../supabase/exam_disqualified_review.sql',import.meta.url),'utf8');
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE exams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,questions jsonb);`);
  for (const f of ['exam_mode.sql','exam_mode_v2.sql','certificates.sql','exam_pause_repair.sql','exam_paper_results.sql','exam_account_claims.sql','exam_timeout_results.sql'])
    await db.exec(await readFile(new URL(`../supabase/${f}`,import.meta.url),'utf8'));
  const exam=(await one(`INSERT INTO exams(title,questions) VALUES('Test','[{"correctAnswer":"A"},{"correctAnswer":"B"},{"correctAnswer":"C"}]') RETURNING id`)).id;
  const session=(await one(`INSERT INTO exam_sessions(exam_id,title,session_code,max_tab_switches) VALUES($1,'Review','REVIEW',1) RETURNING id`,[exam])).id;
  async function create(name,answers={'0':'A','1':'wrong'}) {
    await db.query('SELECT admin_generate_candidates($1,$2::jsonb)',[session,JSON.stringify([{full_name:name}])]);
    return one(`UPDATE exam_candidates SET status='in_progress',token=gen_random_uuid(),expires_at=now()+interval '1 hour',
      started_at=now(),answers=$2::jsonb,question_order=ARRAY[0,1,2] WHERE full_name=$1 RETURNING *`,[name,JSON.stringify(answers)]);
  }
  const historical=await create('Historical');
  await db.query(`UPDATE exam_candidates SET status='disqualified' WHERE id=$1`,[historical.id]);
  await db.exec(migration);
  let row=await one('SELECT * FROM exam_candidates WHERE id=$1',[historical.id]);
  assert.equal(Number(row.score),1);assert.equal(Number(row.total_questions),3);
  assert.equal(row.status,'disqualified');assert.equal(row.include_in_results,false);
  assert.equal(row.submitted_at,null);assert.equal(row.token,null);assert.ok(row.review_scored_at);
  const originalStamp=row.review_scored_at;
  await db.exec(migration);
  assert.deepEqual((await one('SELECT review_scored_at FROM exam_candidates WHERE id=$1',[historical.id])).review_scored_at,originalStamp);
  console.log('PASS historical partial score backfill, exclusion and repeat-migration safety');

  const auto=await create('Tab violation');
  await db.query(`SELECT exam_log_event($1,'tab_blur','{}')`,[auto.token]);
  const result=(await one(`SELECT exam_log_event($1,'tab_blur','{}') AS r`,[auto.token])).r;
  assert.equal(result.disqualified,true);
  row=await one('SELECT * FROM exam_candidates WHERE id=$1',[auto.id]);
  assert.equal(row.status,'disqualified');assert.equal(Number(row.score),1);assert.equal(row.include_in_results,false);
  assert.deepEqual(row.answers,auto.answers);assert.equal(row.submitted_at,null);
  await assert.rejects(db.query(`SELECT exam_submit($1,'{"0":"A","1":"B","2":"C"}',false)`,[auto.token]));
  await assert.rejects(db.query(`UPDATE exam_candidates SET answers='{}' WHERE id=$1`,[auto.id]),/frozen/);
  const login=(await one(`SELECT exam_candidate_login('REVIEW',$1,$2,NULL) AS r`,[auto.access_code,auto.password_plain])).r;
  assert.ok(login.error);assert.equal(login.score,undefined);
  const blank=await create('Blank manual stop',{});
  await db.query(`SELECT admin_candidate_action($1,'disqualify',0,'admin','Stopped by invigilator')`,[blank.id]);
  assert.equal(Number((await one('SELECT score FROM exam_candidates WHERE id=$1',[blank.id])).score),0);
  console.log('PASS tab-rule and manual-stop scoring, blank scores, frozen answers and no student result access');

  const tpl=(await one(`INSERT INTO certificate_templates(name) VALUES('Pass') RETURNING id`)).id;
  await db.query(`UPDATE exam_sessions SET results_published_at=now(),certificate_mode='on_submit',certificate_bands=$2::jsonb WHERE id=$1`,[session,JSON.stringify([{minPercent:0,templateId:tpl,band:'Pass'}])]);
  assert.equal((await one(`SELECT _cert_issue($1,'admin') AS r`,[auto.id])).r.issued,false);
  const privateResult=(await one('SELECT _exam_account_result($1,true) AS r',[auto.id])).r;
  assert.equal(privateResult.score,null);assert.equal(privateResult.certificate,null);assert.deepEqual(privateResult.breakdown,[]);
  const completed=await create('Completed then stopped',{'0':'A','1':'B'});
  await db.query(`SELECT exam_submit($1,'{"0":"A","1":"B"}',false)`,[completed.token]);
  assert.ok(await one('SELECT id FROM certificates WHERE candidate_id=$1 AND revoked_at IS NULL',[completed.id]));
  await db.query(`SELECT admin_candidate_action($1,'disqualify',0,'admin','Reviewed violation')`,[completed.id]);
  row=await one('SELECT * FROM exam_candidates WHERE id=$1',[completed.id]);
  assert.equal(Number(row.score),2);assert.ok(row.submitted_at);
  assert.equal(await one('SELECT id FROM certificates WHERE candidate_id=$1 AND revoked_at IS NULL',[completed.id]),undefined);
  console.log('PASS publication/certificate exclusion, existing grade preservation and active certificate revocation');

  await db.query(`SELECT admin_candidate_action($1,'reinstate',0,'admin','Appeal upheld')`,[auto.id]);
  row=await one('SELECT * FROM exam_candidates WHERE id=$1',[auto.id]);
  assert.equal(row.status,'in_progress');assert.equal(row.score,null);assert.equal(row.include_in_results,true);
  assert.equal(row.review_scored_at,null);assert.deepEqual(row.answers,auto.answers);
  await db.query(`SELECT admin_candidate_action($1,'reset',0,'admin','New attempt authorized')`,[blank.id]);
  row=await one('SELECT * FROM exam_candidates WHERE id=$1',[blank.id]);
  assert.equal(row.status,'pending');assert.equal(row.score,null);assert.equal(row.include_in_results,true);
  assert.ok(Number((await one(`SELECT count(*) AS n FROM exam_audit_log WHERE candidate_id=$1 AND action='candidate.disqualified_review_score'`,[auto.id])).n)>0);
  // Imported paper marks must never be replaced by an empty online answer map.
  const paperSession=(await one(`INSERT INTO exam_sessions(exam_id,title,session_code) VALUES($1,'Paper','PAPER') RETURNING id`,[exam])).id;
  const people=[{reference:'P1',fullName:'Paper',school:'',grade:'',score:'36.5',maximum:'60'}];
  const preview=(await one(`SELECT admin_import_paper_results($1,$2::jsonb,'admin') AS r`,[paperSession,JSON.stringify(people)])).r;
  await db.query(`SELECT admin_import_paper_results($1,$2::jsonb,'admin','marks.xlsx',true,$3)`,[paperSession,JSON.stringify(people),preview.review]);
  await db.query(`UPDATE exam_candidates SET status='disqualified' WHERE session_id=$1`,[paperSession]);
  row=await one('SELECT * FROM exam_candidates WHERE session_id=$1',[paperSession]);
  assert.equal(Number(row.score),36.5);assert.equal(Number(row.total_questions),60);assert.equal(row.include_in_results,false);
  console.log('PASS explicit reinstatement/reset, audit retention and unchanged paper marks');
} finally { await db.close(); }
