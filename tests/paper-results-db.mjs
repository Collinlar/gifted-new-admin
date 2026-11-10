import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';

const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE exams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, questions jsonb);`);
  for (const file of ['exam_mode.sql', 'exam_mode_v2.sql', 'certificates.sql', 'exam_results_images.sql', 'exam_paper_results.sql', 'exam_paper_results.sql']) {
    await db.exec(await readFile(new URL(`../supabase/${file}`, import.meta.url), 'utf8'));
  }
  console.log('PASS actual migrations apply and paper migration reruns');
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const exam = (await scalar(`INSERT INTO exams(title, questions) VALUES ('Maths', '[{"question":"1+1?","correctAnswer":"2","answers":["1","2"],"image":"diagram.png"}]') RETURNING id`)).id;
  const session = (await scalar(`INSERT INTO exam_sessions(exam_id, title, session_code) VALUES ($1, 'Combined sitting', 'COMBINED') RETURNING id`, [exam])).id;
  const row = (reference, fullName, score = '60', maximum = '100') => ({ reference, fullName, score, maximum, school: 'School A', grade: '6' });
  async function call(rows, options = {}) {
    return (await scalar(`SELECT admin_import_paper_results($1,$2::jsonb,'admin@example.test','results.xlsx',$3,$4,$5,$6) AS result`,
      [session, JSON.stringify(rows), options.commit || false, options.review || null, options.correct || false, options.reason || ''])).result;
  }
  async function save(rows, options = {}) {
    const preview = await call(rows, options);
    assert.equal(preview.errors, 0, JSON.stringify(preview.rows));
    return call(rows, { ...options, commit: true, review: preview.review });
  }
  const count = async () => Number((await scalar('SELECT count(*) AS n FROM exam_candidates')).n);
  await db.query(`SELECT admin_generate_candidates($1, '[{"full_name":"Online Student"}]')`, [session]);
  const online = await scalar(`SELECT * FROM exam_candidates WHERE entry_source='online'`);
  const login = (await scalar(`SELECT exam_candidate_login('COMBINED',$1,$2,NULL) AS result`, [online.access_code, online.password_plain])).result;
  assert.equal(login.mode, 'exam');
  await db.query(`SELECT exam_get_paper($1)`, [login.token]);
  const submitted = (await scalar(`SELECT exam_submit($1,'{"0":"2"}',false) AS result`, [login.token])).result;
  assert.equal(submitted.submitted, true);
  assert.equal(Number((await scalar(`SELECT score FROM exam_candidates WHERE id=$1`, [online.id])).score), 1);
  console.log('PASS existing online login, paper delivery and automatic scoring after migration');
  const paper = [row('001', 'Paper One', '36.5', '60'), row('002', 'Paper Two', '40')];
  assert.equal((await call(paper)).errors, 0);
  assert.equal(await count(), 1, 'preview writes nothing');
  const first = await save(paper);
  assert.equal(first.added, 2);
  assert.equal(await count(), 3);
  assert.equal((await save(paper)).skipped, 2);
  assert.equal(await count(), 3);
  console.log('PASS mixed roster, decimals, dry run and idempotent imports');

  for (const invalid of [row('003', 'Bad', '101'), row('003', 'Bad', '-1'), row('003', 'Bad', '1', '0'), row('', 'Bad')]) {
    const preview = await call([row('004', 'Valid'), invalid]);
    assert.ok(preview.errors > 0);
    await assert.rejects(call([row('004', 'Valid'), invalid], { commit: true, review: preview.review }));
    assert.equal(await count(), 3);
  }
  assert.ok((await call([row('dup', 'A'), row('DUP', 'B')])).errors > 0);
  assert.ok((await call([row(online.access_code, 'Overwrite')])).errors > 0);
  assert.ok((await call([row('003', 'Paper One')])).errors > 0);
  await save([{ ...row('003', 'Paper One'), distinct: true }]);
  console.log('PASS invalid-batch rollback, duplicate detection, online protection and explicit distinct people');

  const staleRows = [row('005', 'Stale')];
  const stale = await call(staleRows);
  await db.query(`UPDATE exam_sessions SET title='Updated sitting' WHERE id=$1`, [session]);
  await assert.rejects(call(staleRows, { commit: true, review: stale.review }), /changed since review/);
  const correction = [row('001', 'Paper One', '45', '60')];
  assert.ok((await call(correction)).errors > 0);
  assert.equal((await save(correction, { correct: true, reason: 'Marker corrected total' })).updated, 1);
  assert.equal(Number((await scalar(`SELECT score FROM exam_candidates WHERE candidate_reference='001'`)).score), 45);
  assert.equal(Number((await scalar(`SELECT count(*) AS n FROM exam_audit_log WHERE action='candidate.paper_correction'`)).n), 1);
  await assert.rejects(db.query(`UPDATE exam_candidates SET status='pending' WHERE candidate_reference='001'`), /Paper results must remain/);
  console.log('PASS stale review, audited corrections and paper lifecycle guard');

  const template = (await scalar(`INSERT INTO certificate_templates(name) VALUES ('Pass') RETURNING id`)).id;
  await db.query(`UPDATE exam_sessions SET certificate_mode='on_publish', certificate_bands=$2::jsonb WHERE id=$1`,
    [session, JSON.stringify([{ minPercent: 50, templateId: template, band: 'Pass' }])]);
  await db.query(`UPDATE exam_sessions SET results_published_at=now(), results_show_breakdown=true WHERE id=$1`, [session]);
  assert.equal(Number((await scalar(`SELECT count(*) AS n FROM certificates WHERE revoked_at IS NULL`)).n), 3, 'online and qualifying paper candidates get certificates');
  assert.ok((await call([row('006', 'Late')])).errors > 0, 'published results cannot silently change');
  const candidate = await scalar(`SELECT * FROM exam_candidates WHERE candidate_reference='001'`);
  const deniedLogin = (await scalar(`SELECT exam_candidate_login('COMBINED',$1,NULL,NULL) AS result`, [candidate.access_code])).result;
  assert.ok(deniedLogin.error, 'null password must never grant result access');
  const result = (await scalar(`SELECT exam_candidate_login('COMBINED',$1,$2,NULL) AS result`, [candidate.access_code, candidate.password_plain])).result;
  assert.equal(result.mode, 'results'); assert.equal(result.entrySource, 'paper');
  assert.equal(result.showBreakdown, false); assert.deepEqual(result.breakdown, []);
  assert.equal(result.score, 45); assert.ok(result.certificate);
  const onlineResult = (await scalar(`SELECT exam_candidate_login('COMBINED',$1,$2,NULL) AS result`, [online.access_code, online.password_plain])).result;
  assert.equal(onlineResult.showBreakdown, true); assert.equal(onlineResult.breakdown[0].image, 'diagram.png');
  await db.query(`UPDATE exam_sessions SET results_published_at=NULL WHERE id=$1`, [session]);
  assert.ok((await call([row('001', 'Paper One', '46', '60')], { correct: true, reason: 'Fix mark' })).errors > 0, 'live certificate blocks correction');
  await db.query(`UPDATE certificates SET revoked_at=now() WHERE candidate_id=$1`, [candidate.id]);
  await save([row('001', 'Paper One', '46', '60')], { correct: true, reason: 'Fix mark' });
  await db.query(`UPDATE exam_sessions SET certificate_mode='on_submit' WHERE id=$1`, [session]);
  await save([row('007', 'Immediate Pass', '50'), row('008', 'Immediate Below', '49'), row('009', 'Rounded Existing Rule', '49.6')]);
  assert.equal(Number((await scalar(`SELECT count(*) AS n FROM certificates c JOIN exam_candidates e ON e.id=c.candidate_id WHERE e.candidate_reference IN ('007','008','009') AND c.revoked_at IS NULL`)).n), 2);
  console.log('PASS shared certificate bands, publication controls, corrections with revocation, on-submit and unchanged rounding');

  const permitted = await scalar(`SELECT has_function_privilege('anon','admin_import_paper_results(uuid,jsonb,text,text,boolean,text,boolean,text)','EXECUTE') AS anon,
    has_function_privilege('authenticated','admin_import_paper_results(uuid,jsonb,text,text,boolean,text,boolean,text)','EXECUTE') AS authenticated,
    has_function_privilege('service_role','admin_import_paper_results(uuid,jsonb,text,text,boolean,text,boolean,text)','EXECUTE') AS service`);
  assert.deepEqual(permitted, { anon: false, authenticated: false, service: true });
  console.log('PASS import RPC restricted to service role');

  // A failure during issuance must roll back the whole import, including earlier rows.
  await db.query(`UPDATE exam_sessions SET certificate_bands=$2::jsonb WHERE id=$1`,
    [session, JSON.stringify([{ minPercent: 50, templateId: 'not-a-uuid', band: 'Broken' }])]);
  const beforeFailure = await count();
  const broken = [row('010', 'First below band', '10'), row('011', 'Second triggers failure', '80')];
  const brokenPreview = await call(broken);
  await assert.rejects(call(broken, { commit: true, review: brokenPreview.review }));
  assert.equal(await count(), beforeFailure);
  console.log('PASS certificate failure rolls back all candidate writes');

  const largeSession = (await scalar(`INSERT INTO exam_sessions(exam_id,title,session_code) VALUES ($1,'500 participants','LARGE') RETURNING id`, [exam])).id;
  await db.query(`INSERT INTO exam_candidates(session_id,full_name,access_code,password_plain,password_hash,status,submitted_at,score,total_questions)
    SELECT $1, 'Online ' || n, 'ONLINE-' || n, 'test-only', 'test-only', 'submitted', now(), 60, 100 FROM generate_series(1,300) n`, [largeSession]);
  const largeRows = Array.from({ length: 200 }, (_, i) => row(`PAPER-${i}`, `Paper ${i}`));
  const largePreview = (await scalar(`SELECT admin_import_paper_results($1,$2::jsonb,'tester') AS result`, [largeSession, JSON.stringify(largeRows)])).result;
  assert.equal(largePreview.errors, 0);
  await db.query(`SELECT admin_import_paper_results($1,$2::jsonb,'tester','large.xlsx',true,$3)`, [largeSession, JSON.stringify(largeRows), largePreview.review]);
  assert.equal(Number((await scalar(`SELECT count(*) AS n FROM exam_candidates WHERE session_id=$1 AND status='submitted'`, [largeSession])).n), 500);
  assert.equal(Number((await scalar(`SELECT count(*) AS n FROM exam_candidates WHERE session_id=$1 AND entry_source='paper'`, [largeSession])).n), 200);
  console.log('PASS 300 online + 200 paper = 500 completed candidates');
} finally { await db.close(); }
