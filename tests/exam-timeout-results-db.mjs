import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
const db = new PGlite({ extensions: { pgcrypto } });
const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE exams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,questions jsonb);`);
  for (const file of ['exam_mode.sql','exam_mode_v2.sql','certificates.sql','exam_pause_repair.sql','exam_results_images.sql','exam_paper_results.sql','exam_account_claims.sql','exam_timeout_results.sql','exam_timeout_results.sql'])
    await db.exec(await readFile(new URL(`../supabase/${file}`,import.meta.url),'utf8'));
  console.log('PASS timeout migration and repeat migration');
  const exam=(await one(`INSERT INTO exams(title,questions) VALUES('Test','[{"question":"Q1","correctAnswer":"A"},{"question":"Q2","correctAnswer":"B"},{"question":"Q3","correctAnswer":"C"}]') RETURNING id`)).id;
  const session=(await one(`INSERT INTO exam_sessions(exam_id,title,session_code,show_results_to_candidate) VALUES($1,'Test sitting','TIME',true) RETURNING id`,[exam])).id;
  async function candidate(name, expired=true, answers={'0':'A','1':'wrong'}) {
    await db.query(`SELECT admin_generate_candidates($1,$2::jsonb)`,[session,JSON.stringify([{full_name:name}])]);
    return one(`UPDATE exam_candidates SET status='in_progress',token=gen_random_uuid(),started_at=now()-interval '1 hour',
      expires_at=now()+$2::interval,answers=$3::jsonb,question_order=ARRAY[0,1,2] WHERE full_name=$1 RETURNING *`,
      [name,expired?'-10 seconds':'10 minutes',JSON.stringify(answers)]);
  }
  const expired=await candidate('Offline browser');
  const blank=await candidate('Blank',true,{});
  const live=await candidate('Live',false);
  const stopped=await candidate('Stopped');
  await db.query(`UPDATE exam_candidates SET status='disqualified' WHERE id=$1`,[stopped.id]);
  await db.query(`SELECT admin_finalize_expired_exams($1)`,[session]);
  let c=await one(`SELECT * FROM exam_candidates WHERE id=$1`,[expired.id]);
  assert.equal(c.status,'submitted');assert.equal(c.timed_out,true);assert.equal(c.include_in_results,true);
  assert.equal(Number(c.score),1);assert.equal(Number(c.total_questions),3);
  assert.equal(Number((await one('SELECT score FROM exam_candidates WHERE id=$1',[blank.id])).score),0);
  assert.equal((await one('SELECT status FROM exam_candidates WHERE id=$1',[live.id])).status,'in_progress');
  assert.equal((await one('SELECT status FROM exam_candidates WHERE id=$1',[stopped.id])).status,'disqualified');
  assert.equal((await one('SELECT admin_finalize_expired_exams($1) AS r',[session])).r.finalized,0);
  console.log('PASS browser-independent finalization, partial/blank scoring, full denominator, stopped/live isolation and retry safety');

  let r=(await one(`SELECT exam_submit($1,'{"0":"A","1":"B","2":"C"}',true) AS r`,[expired.token])).r;
  assert.equal(r.score,1);assert.equal(r.timedOut,true);
  r=(await one(`SELECT exam_save_progress($1,'{"0":"A","1":"B","2":"C"}') AS r`,[expired.token])).r;
  assert.equal(r.saved,false);assert.equal(r.submission.score,1);
  r=(await one('SELECT exam_get_paper($1) AS r',[expired.token])).r;
  assert.equal(r.completed,true);
  await db.query(`SELECT exam_log_event($1,'tab_blur','{}')`,[expired.token]);
  assert.equal((await one('SELECT status FROM exam_candidates WHERE id=$1',[expired.id])).status,'submitted');
  const late=await candidate('Late API');
  r=(await one(`SELECT exam_submit($1,'{"0":"A","1":"B","2":"C"}',false) AS r`,[late.token])).r;
  assert.equal(r.score,1);assert.equal(r.timedOut,true);
  r=(await one(`SELECT exam_submit($1,'{"0":"A","1":"B","2":"C","00":"A","-1":"C"}',true) AS r`,[live.token])).r;
  assert.equal(r.score,3);assert.equal(r.timedOut,false);
  console.log('PASS late payload cannot alter marks, completed tokens are read-only and client auto flag cannot fake expiry');

  const pause=await candidate('Paused',true);
  await db.query(`UPDATE exam_sessions SET paused_at=now()-interval '1 minute',status='paused' WHERE id=$1`,[session]);
  await db.query(`SELECT admin_finalize_expired_exams($1)`,[session]);
  assert.equal((await one('SELECT status FROM exam_candidates WHERE id=$1',[pause.id])).status,'in_progress');
  await assert.rejects(db.query(`SELECT exam_submit($1,'{}',true)`,[pause.token]),/paused/);
  await db.query(`SELECT admin_session_action($1,'resume',0,NULL,'admin','Resume test')`,[session]);
  assert.equal((await one('SELECT status FROM exam_candidates WHERE id=$1',[pause.id])).status,'in_progress');
  await db.query(`UPDATE exam_candidates SET expires_at=now()-interval '1 second' WHERE id=$1`,[pause.id]);
  r=(await one('SELECT exam_heartbeat($1) AS r',[pause.token])).r;
  assert.equal(r.status,'submitted');assert.equal(r.submission.score,1);
  const returning=await candidate('Returning login');
  r=(await one(`SELECT exam_candidate_login('TIME',$1,$2,NULL) AS r`,[returning.access_code,returning.password_plain])).r;
  assert.equal((await one('SELECT status FROM exam_candidates WHERE id=$1',[returning.id])).status,'submitted');
  console.log('PASS paused clock preservation, resume, heartbeat and returning-candidate finalization');

  const template=(await one(`INSERT INTO certificate_templates(name) VALUES('Pass') RETURNING id`)).id;
  await db.query(`UPDATE exam_sessions SET certificate_mode='on_publish',certificate_bands=$2::jsonb WHERE id=$1`,[session,JSON.stringify([{minPercent:30,templateId:template,band:'Pass'}])]);
  const publishExpired=await candidate('Expired at publication');
  await db.query(`SELECT admin_session_action($1,'publish_results',0,NULL,'admin','Publish')`,[session]);
  assert.equal((await one('SELECT status FROM exam_candidates WHERE id=$1',[publishExpired.id])).status,'submitted');
  assert.ok(await one('SELECT id FROM certificates WHERE candidate_id=$1 AND revoked_at IS NULL',[expired.id]));
  await assert.rejects(db.query(`SELECT admin_set_timeout_result($1,false,'admin','')`,[expired.id]),/reason/);
  await db.query(`SELECT admin_set_timeout_result($1,false,'admin','Reviewed incomplete attempt')`,[expired.id]);
  assert.equal(Number((await one('SELECT score FROM exam_candidates WHERE id=$1',[expired.id])).score),1);
  assert.equal(await one('SELECT id FROM certificates WHERE candidate_id=$1 AND revoked_at IS NULL',[expired.id]),undefined);
  r=(await one(`SELECT _cert_issue($1,'admin') AS r`,[expired.id])).r;assert.equal(r.issued,false);
  r=(await one(`SELECT exam_candidate_login('TIME',$1,$2,NULL) AS r`,[expired.access_code,expired.password_plain])).r;
  assert.equal(r.resultIncluded,false);assert.equal(r.resultsOut,false);assert.equal(r.score,undefined);
  r=(await one('SELECT _exam_account_result($1,true) AS r',[expired.id])).r;
  assert.equal(r.resultIncluded,false);assert.equal(r.score,null);assert.equal(r.certificate,null);assert.deepEqual(r.breakdown,[]);
  await db.query(`SELECT admin_set_timeout_result($1,true,'admin','Review approved')`,[expired.id]);
  assert.ok(await one('SELECT id FROM certificates WHERE candidate_id=$1 AND revoked_at IS NULL',[expired.id]));
  assert.equal(Number((await one(`SELECT count(*) AS n FROM exam_audit_log WHERE candidate_id=$1 AND action='candidate.result_inclusion'`,[expired.id])).n),2);
  await assert.rejects(db.query(`SELECT admin_set_timeout_result($1,false,'admin','Cannot exclude normal')`,[live.id]),/timed-out/);
  const perms=await one(`SELECT has_function_privilege('anon','admin_finalize_expired_exams(uuid)','EXECUTE') AS sweep,
    has_function_privilege('authenticated','admin_set_timeout_result(uuid,boolean,text,text)','EXECUTE') AS decide`);
  assert.deepEqual(perms,{sweep:false,decide:false});
  console.log('PASS publication sweep, audited include/exclude, retained marks, withheld results, certificate revoke/reissue and admin-only decisions');
} finally { await db.close(); }
