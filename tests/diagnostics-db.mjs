import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE tracks (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
    CREATE TABLE exams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), questions jsonb);
    INSERT INTO exams(questions) VALUES ('[{"question":"existing assessment"}]');`);
  const migration = await readFile(new URL('../supabase/diagnostics_v1.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.exec(migration);
  console.log('PASS migration applies and reruns');
  const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const track = (await scalar(`INSERT INTO tracks(name) VALUES ('Mathematics') RETURNING id`)).id;
  await db.exec('SET ROLE service_role');
  await db.query(`INSERT INTO track_skills(track_id, topic, name) VALUES ($1, 'Fractions', 'Compare fractions')`, [track]);
  await assert.rejects(db.query(`INSERT INTO track_skills(track_id, topic, name) VALUES ($1, ' fractions ', 'COMPARE FRACTIONS')`, [track]), /duplicate key/);
  const draft = { title: 'Entry', trackId: track, questions: [] };
  const item = await scalar(`INSERT INTO diagnostics(track_id,draft) VALUES ($1,$2) RETURNING *`, [track, draft]);
  const publish = (revision, snapshot = draft) => scalar(`SELECT publish_diagnostic($1,$2,$3,'admin@example.test') AS version`, [item.id, revision, snapshot]);
  assert.equal((await publish(1)).version, 1);
  await assert.rejects(publish(1), /Reload before publishing/);
  assert.equal(Number((await scalar('SELECT count(*) AS n FROM diagnostic_versions')).n), 1);
  const before = await scalar('SELECT * FROM diagnostic_versions WHERE diagnostic_id=$1', [item.id]);
  const changed = { ...draft, title: 'Edited draft' };
  const updated = await db.query('UPDATE diagnostics SET draft=$1, revision=revision+1 WHERE id=$2 AND revision=2 RETURNING id', [changed, item.id]);
  assert.equal(updated.rows.length, 1);
  assert.equal((await db.query('UPDATE diagnostics SET draft=$1 WHERE id=$2 AND revision=2 RETURNING id', [draft, item.id])).rows.length, 0);
  assert.deepEqual((await scalar('SELECT snapshot FROM diagnostic_versions WHERE diagnostic_id=$1', [item.id])).snapshot, before.snapshot);
  assert.equal((await publish(3, changed)).version, 2);
  await assert.rejects(db.exec('UPDATE diagnostic_versions SET snapshot=\'{}\''), /permission denied|immutable/);
  console.log('PASS service-role publication, stale revision rejection, draft isolation, and version immutability');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`RESET ROLE; SET ROLE ${role}`);
    for (const table of ['diagnostics', 'diagnostic_versions', 'track_skills']) {
      await assert.rejects(db.exec(`SELECT * FROM ${table}`), /permission denied/);
    }
    await assert.rejects(publish(4), /permission denied/);
  }
  await db.exec('RESET ROLE');
  assert.deepEqual((await scalar('SELECT questions FROM exams')).questions, [{ question: 'existing assessment' }]);
  console.log('PASS learner roles cannot read answer keys or publish; existing assessment data unchanged');
} finally { await db.close(); }
