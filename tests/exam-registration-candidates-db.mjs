import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';
import { pgcrypto } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/contrib/pgcrypto.js';

const db = new PGlite({ extensions: { pgcrypto } });
const file = name => readFile(new URL('../supabase/' + name, import.meta.url), 'utf8');
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE TABLE exams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text, questions jsonb);
    CREATE TABLE users(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),first_name text,last_name text,school_name text,grade text);`);
  await db.exec((await file('registrations.sql')).split('-- ── Answer memory')[0]);
  const guests = await file('registrations_v4.sql');
  await db.exec(guests.slice(guests.indexOf('ALTER TABLE registrations'), guests.indexOf('-- ── Prefill')));
  for (const name of ['exam_mode.sql', 'exam_mode_v2.sql', 'exam_registration_candidates.sql', 'exam_registration_candidates.sql']) await db.exec(await file(name));
  const form = (await scalar(`INSERT INTO registration_forms(title,fields) VALUES ('American Math Olympiad',
    '[{"key":"participant","source":"profile.full_name"},{"key":"institution","source":"profile.school_name"}]') RETURNING id`)).id;
  const otherForm = (await scalar(`INSERT INTO registration_forms(title) VALUES ('Other') RETURNING id`)).id;
  const user = (await scalar(`INSERT INTO users(first_name,last_name,school_name,grade) VALUES ('Test','Account','School A','6') RETURNING id`)).id;
  const addReg = async (status, answers, owner = null, formId = form) => (await scalar(`INSERT INTO registrations(form_id,user_id,status,answers,payment_status)
    VALUES ($1,$2,$3,$4,'paid') RETURNING id`, [formId, owner, status, answers])).id;
  const account = await addReg('accepted', {}, user);
  const guest = await addReg('submitted', { participant: 'Guest Without Email', institution: 'School B', grade: '7' });
  const rejected = await addReg('rejected', { participant: 'Rejected' });
  const unnamed = await addReg('submitted', {});
  const foreign = await addReg('accepted', { participant: 'Other Form' }, null, otherForm);
  const fresh = await addReg('accepted', { participant: 'Fresh Guest' });
  const sitting = async code => (await scalar(`INSERT INTO exam_sessions(exam_id,title,session_code) VALUES (gen_random_uuid(),'AMO sitting',$1) RETURNING id`, [code])).id;
  const first = await sitting('AMO1'); const second = await sitting('AMO2');
  const preview = async () => (await scalar('SELECT admin_exam_registration_preview($1,$2) r',[first,form])).r;
  const add = async (ids, session = first) => (await scalar('SELECT admin_add_registration_candidates($1,$2,$3,$4) r',[session,form,ids,'admin@example.test'])).r;
  let rows = await preview();
  assert.equal(rows.find(r => r.id === account).fullName, 'Test Account');
  assert.equal(rows.find(r => r.id === guest).school, 'School B');
  assert.equal(rows.find(r => r.id === guest).eligible, true);
  assert.equal(rows.find(r => r.id === rejected).eligible, false);
  assert.equal(rows.find(r => r.id === unnamed).eligible, false);
  assert.deepEqual(await add([account, guest]), { created: 2, skipped: 0 });
  const credentials = (await db.query('SELECT * FROM exam_candidates ORDER BY full_name')).rows;
  assert.equal(credentials.length, 2);
  assert.ok(credentials.every(c => c.access_code && c.password_plain && c.registration_id));
  assert.equal(credentials.find(c => c.registration_id === guest).user_id, null);
  assert.equal(credentials.find(c => c.registration_id === account).user_id, user);
  assert.equal((await scalar(`SELECT count(*)::int n FROM exam_candidates
    WHERE password_hash=extensions.crypt(password_plain,password_hash)`)).n, 2);
  await assert.rejects(db.query(`INSERT INTO exam_candidates(session_id,registration_id,full_name,access_code,password_hash,password_plain)
    VALUES ($1,$2,'Duplicate','UNIQUE','hash','plain')`,[first,guest]), /unique constraint/);
  assert.deepEqual(await add([account, guest, account]), { created: 0, skipped: 2 });
  assert.deepEqual((await db.query('SELECT * FROM exam_candidates ORDER BY full_name')).rows, credentials);
  assert.deepEqual(await add([guest], second), { created: 1, skipped: 0 });
  assert.ok((await preview()).find(r => r.id === guest).alreadyAdded);
  await assert.rejects(add([foreign]), /no longer in this form/);
  await assert.rejects(add([fresh, rejected]), /no longer eligible/);
  assert.equal((await scalar('SELECT count(*)::int n FROM exam_candidates WHERE registration_id=$1',[fresh])).n, 0);
  await assert.rejects(add([unnamed]), /missing a name/);
  await assert.rejects(add([]), /Select between/);
  await db.query("UPDATE registrations SET status='withdrawn' WHERE id=$1",[fresh]);
  await assert.rejects(add([fresh]), /no longer eligible/);
  await db.query("UPDATE exam_sessions SET status='closed' WHERE id=$1",[second]);
  await assert.rejects(add([account],second), /closed/);
  assert.ok((await scalar("SELECT count(*)::int n FROM exam_audit_log WHERE action='candidate.registration_import'")).n >= 3);
  for (const role of ['anon','authenticated']) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(preview(), /permission denied/);
    await assert.rejects(add([guest]), /permission denied/);
    await db.exec('RESET ROLE');
  }
  console.log('PASS: migration rerun, account and email-free guest preview, credential creation, repeat protection, cross-sitting reuse, invalid/stale selection rollback, closed sitting, audit and permissions.');
} finally { await db.close(); }
