import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';

const db = new PGlite({ extensions: { pgcrypto } });
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const sql = name => readFile(new URL(`../supabase/${name}`, import.meta.url), 'utf8');
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
    CREATE TABLE exams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),title text,questions jsonb);`);
  for (const file of ['exam_mode.sql','exam_mode_v2.sql','certificates.sql','exam_pause_repair.sql',
    'exam_paper_results.sql','exam_account_claims.sql','exam_timeout_results.sql','exam_disqualified_review.sql',
    'exam_candidate_corrections.sql','exam_candidate_corrections.sql']) await db.exec(await sql(file));
  console.log('PASS candidate-correction migration applies and reruns');

  const exam = (await one(`INSERT INTO exams(title,questions) VALUES('Science',
    '[{"question":"Q1","correctAnswer":"A"},{"question":"Q2","correctAnswer":"B"},{"question":"Q3","correctAnswer":"C"}]') RETURNING id`)).id;
  const session = (await one(`INSERT INTO exam_sessions(exam_id,title,session_code,show_results_to_candidate)
    VALUES($1,'Science sitting','CORRECT',true) RETURNING id`, [exam])).id;
  await db.query(`SELECT admin_generate_candidates($1,'[{"full_name":"Timeout Candidate","school":"Old School","grade":"6"}]')`, [session]);
  let candidate = await one(`UPDATE exam_candidates SET status='in_progress',token=gen_random_uuid(),
    started_at=now()-interval '10 minutes',expires_at=now()-interval '1 second',question_order=ARRAY[0,1,2],answers='{}'
    WHERE full_name='Timeout Candidate' RETURNING *`);
  // A previous attempt's answer must remain evidential but must never affect this attempt.
  await db.query(`INSERT INTO exam_answer_log(candidate_id,question_idx,answer,created_at)
    VALUES($1,2,'C',now()-interval '20 minutes'),($1,0,'A',now()-interval '5 minutes'),($1,1,'B',now()-interval '4 minutes')`, [candidate.id]);
  let result = (await one('SELECT admin_finalize_expired_exams($1) r', [session])).r;
  assert.equal(result.finalized, 1);
  candidate = await one('SELECT * FROM exam_candidates WHERE id=$1', [candidate.id]);
  assert.equal(Number(candidate.score), 2);
  assert.deepEqual(candidate.answers, { '0': 'A', '1': 'B' });
  const timeoutEvent = (await one(`SELECT meta FROM exam_events WHERE candidate_id=$1 AND type='auto_submit'`, [candidate.id])).meta;
  assert.equal(timeoutEvent.answerHistoryRecovered, true);
  let transcript = (await one('SELECT admin_get_transcript($1) r', [candidate.id])).r;
  assert.equal(transcript.questions[0].history.length, 1);
  assert.equal(transcript.questions[1].history.length, 1);
  assert.equal(transcript.questions[2].history.length, 0);
  assert.equal(transcript.questions[2].yourAnswer, null);
  console.log('PASS timeout recovers current-attempt server history, scores correct answers, and excludes pre-reset history');

  const template = (await one(`INSERT INTO certificate_templates(name) VALUES('Completion') RETURNING id`)).id;
  await db.query(`UPDATE exam_sessions SET results_published_at=now(),certificate_mode='manual',
    certificate_bands=$2::jsonb WHERE id=$1`, [session, JSON.stringify([{ minPercent: 0, templateId: template, band: 'Completion' }])]);
  result = (await one(`SELECT _cert_issue($1,'admin') r`, [candidate.id])).r;
  assert.equal(result.issued, true);
  const oldSerial = result.serial;
  result = (await one(`SELECT admin_update_exam_candidate($1,'Alexis Serwaa Blackmore','New School','Grade 7','admin@example.test','Verified spelling') r`, [candidate.id])).r;
  assert.equal(result.changed, true);
  assert.equal(result.certificateReissued, true);
  candidate = await one('SELECT * FROM exam_candidates WHERE id=$1', [candidate.id]);
  assert.equal(candidate.full_name, 'Alexis Serwaa Blackmore');
  assert.equal(candidate.school, 'New School');
  assert.equal(candidate.grade, 'Grade 7');
  const oldCert = await one('SELECT * FROM certificates WHERE serial=$1', [oldSerial]);
  assert.ok(oldCert.revoked_at);
  const newCert = await one('SELECT * FROM certificates WHERE candidate_id=$1 AND revoked_at IS NULL', [candidate.id]);
  assert.equal(newCert.snapshot.candidate_name, 'Alexis Serwaa Blackmore');
  assert.equal(newCert.snapshot.school, 'New School');
  assert.equal(newCert.replaces_serial, oldSerial);
  const audit = await one(`SELECT * FROM exam_audit_log WHERE candidate_id=$1 AND action='candidate.profile_update'`, [candidate.id]);
  assert.equal(audit.actor_email, 'admin@example.test');
  assert.equal(audit.detail.before.fullName, 'Timeout Candidate');
  assert.equal(audit.detail.after.fullName, 'Alexis Serwaa Blackmore');
  result = (await one(`SELECT admin_update_exam_candidate($1,'Alexis Serwaa Blackmore','New School','Grade 7','admin@example.test','Checked again') r`, [candidate.id])).r;
  assert.equal(result.changed, false);
  assert.equal(Number((await one('SELECT count(*) n FROM certificates WHERE candidate_id=$1', [candidate.id])).n), 2);
  await assert.rejects(db.query(`SELECT admin_update_exam_candidate($1,'','School','7','admin','Reason')`, [candidate.id]), /2 to 160/);
  await assert.rejects(db.query(`SELECT admin_update_exam_candidate($1,'Name','School','7','admin','')`, [candidate.id]), /reason/i);
  console.log('PASS audited name/school/grade correction, automatic certificate replacement, no-op safety and validation');

  // A reset begins a distinct attempt. The October-style history remains in the
  // audit trail but cannot appear in or be scored for the later attempt.
  await db.query(`SELECT admin_candidate_action($1,'reset',0,'admin','New attempt')`, [candidate.id]);
  await db.query(`UPDATE exam_candidates SET status='in_progress',started_at=now()+interval '1 second',
    expires_at=now()+interval '1 hour',token=gen_random_uuid(),question_order=ARRAY[0,1,2] WHERE id=$1`, [candidate.id]);
  assert.deepEqual((await one('SELECT _exam_current_answers($1) r', [candidate.id])).r, {});
  transcript = (await one('SELECT admin_get_transcript($1) r', [candidate.id])).r;
  assert.ok(transcript.questions.every(question => question.history.length === 0));

  for (const role of ['anon', 'authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query(`SELECT admin_update_exam_candidate($1,'Name','School','7','admin','Reason')`, [candidate.id]), /permission denied/);
    await assert.rejects(db.query('SELECT _exam_current_answers($1)', [candidate.id]), /permission denied/);
    await db.exec('RESET ROLE');
  }
  console.log('PASS reset boundary and admin-only correction/recovery permissions');
} finally {
  await db.close();
}
