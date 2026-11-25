import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';
const db = new PGlite({ extensions: { pgcrypto } });
const file = name => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
const one = async (sql,args=[]) => (await db.query(sql,args)).rows[0];
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE exams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,questions jsonb,instructions jsonb);`);
  for (const name of ['exam_mode.sql','exam_mode_v2.sql','certificates.sql','exam_pause_repair.sql',
    'exam_results_images.sql','exam_paper_results.sql','exam_account_claims.sql','exam_timeout_results.sql',
    'exam_candidate_corrections.sql','exam_disqualified_review.sql','certificate_payments.sql',
    'exam_answer_integrity.sql','exam_answer_integrity.sql']) await db.exec(await file(name));
  const questions=[{question:'First option is correct',answers:['Same','Other'],answerValues:['Same','Other'],
    optionIds:['option_1','option_2'],correctAnswerIndex:0,correctAnswer:'Same',correctOptionId:'option_1'}];
  const exam=(await one(`INSERT INTO exams(title,questions,instructions) VALUES('Integrity',$1,'[]') RETURNING id`,[JSON.stringify(questions)])).id;
  const session=(await one(`INSERT INTO exam_sessions(exam_id,title,session_code,show_results_to_candidate,results_show_breakdown)
    VALUES($1,'Integrity sitting','INTEGRITY',true,true) RETURNING id`,[exam])).id;
  assert.deepEqual((await one('SELECT questions_snapshot q FROM exam_sessions WHERE id=$1',[session])).q,questions);
  await db.query(`UPDATE exams SET questions='[]' WHERE id=$1`,[exam]);
  assert.deepEqual((await one('SELECT questions_snapshot q FROM exam_sessions WHERE id=$1',[session])).q,questions);
  await db.query(`SELECT admin_generate_candidates($1,$2::jsonb)`,[session,JSON.stringify([{full_name:'Candidate'}])]);
  const c=await one(`SELECT * FROM exam_candidates WHERE session_id=$1`,[session]);
  let login=(await one(`SELECT exam_candidate_login('INTEGRITY',$1,$2,NULL) r`,[c.access_code,c.password_plain])).r;
  const paper=(await one(`SELECT exam_get_paper($1) r`,[login.token])).r;
  assert.deepEqual(paper.questions[0].answerValues,['option_1','option_2']);
  assert.equal('correctAnswerIndex' in paper.questions[0],false);
  assert.equal('correctAnswer' in paper.questions[0],false);
  let submitted=(await one(`SELECT exam_submit($1,'{"0":"option_1"}',false) r`,[login.token])).r;
  assert.equal(submitted.score,1);
  await db.query(`UPDATE exam_sessions SET results_published_at=now() WHERE id=$1`,[session]);
  login=(await one(`SELECT exam_candidate_login('INTEGRITY',$1,$2,NULL) r`,[c.access_code,c.password_plain])).r;
  assert.equal(login.breakdown[0].correct,true);
  assert.equal(login.breakdown[0].correctAnswerIndex,0);
  assert.equal(login.breakdown[0].correctValue,'option_1');
  const transcript=(await one(`SELECT admin_get_transcript($1) r`,[c.id])).r;
  assert.equal(transcript.questions[0].correct,true);

  await db.query(`UPDATE exam_candidates SET score=0 WHERE id=$1`,[c.id]);
  let repair=(await one(`SELECT admin_recalculate_session_scores($1,'admin','',false) r`,[session])).r;
  assert.equal(repair.changed,1); assert.equal(repair.apply,false);
  await assert.rejects(db.query(`SELECT admin_recalculate_session_scores($1,'admin','',true)`,[session]),/reason/);
  repair=(await one(`SELECT admin_recalculate_session_scores($1,'admin','Verified answer key',true) r`,[session])).r;
  assert.equal(repair.changed,1);
  assert.equal(Number((await one('SELECT score FROM exam_candidates WHERE id=$1',[c.id])).score),1);
  assert.equal(Number((await one(`SELECT count(*) n FROM exam_audit_log WHERE action='candidate.score_recalculated'`)).n),1);
  const perms=await one(`SELECT has_function_privilege('anon','admin_recalculate_session_scores(uuid,text,text,boolean)','EXECUTE') anon,
    has_function_privilege('authenticated','admin_recalculate_session_scores(uuid,text,text,boolean)','EXECUTE') authenticated`);
  assert.deepEqual(perms,{anon:false,authenticated:false});
  console.log('PASS frozen sitting with editable source, opaque option ids, hidden key, correct index zero, transcript, preview/apply repair, rerun and permissions.');
} finally { await db.close(); }
