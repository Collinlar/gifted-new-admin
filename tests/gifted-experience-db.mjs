import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.js';

const db = new PGlite();
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table tracks(id uuid primary key);`);
  for (const file of ['diagnostics_v1.sql', 'diagnostics_learner_v1.sql', 'gifted_experience_v1.sql', 'gifted_experience_routing_v2.sql', 'gifted_experience_routing_v2.sql']) {
    await db.exec(await readFile(new URL('../supabase/' + file, import.meta.url), 'utf8'));
  }
  const user = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  await db.query('insert into auth.users values ($1),($2)', [user, other]);
  await db.query('insert into tracks values ($1)', [user]);
  await db.exec('set role service_role');
  const skill = (await db.query("insert into track_skills(track_id,topic,name) values($1,'Topic','Skill') returning id", [user])).rows[0].id;
  const paper = { title: 'Entry', trackId: user, minimumEvidence: 3, targetPercent: 75, skills: [{ id: skill, name: 'Skill' }], questions: ['beginner','intermediate','advanced'].map((difficulty, i) => ({ id: 'q' + i, skillId: skill, difficulty, prompt: 'Q' + i, options: ['yes','no'], correctIndex: 0, explanation: 'because' })) };
  const diagnostic = (await db.query('insert into diagnostics(track_id,draft) values($1,$2) returning id', [user, paper])).rows[0].id;
  await db.query("select publish_diagnostic($1,1,$2,'test')", [diagnostic, paper]);
  const snapshot = { title: 'Math route', trackId: user, description: 'Guided', steps: [
    { id: 'start', type: 'diagnostic', title: 'Find your level', description: '', href: '/diagnostics', diagnosticId: diagnostic, diagnosticVersion: 1 },
    { id: 'develop', type: 'resource', title: 'Build the skill', description: '', href: '/learning-management', condition: { outcome: 'needs_development', skillId: skill } },
    { id: 'strength', type: 'competition', title: 'Use the skill', description: '', href: '/programs', condition: { outcome: 'demonstrated_strength', skillId: skill } },
  ] };
  const experience = (await db.query('insert into gifted_experiences(track_id,draft) values($1,$2) returning id', [user, snapshot])).rows[0].id;
  assert.equal((await db.query("select publish_gifted_experience($1,1,$2,'test') version", [experience, snapshot])).rows[0].version, 1);
  const assignment = (await db.query('select assign_gifted_experience($1,1,$2) id', [experience, user])).rows[0].id;
  await db.query("insert into skill_content_mappings(track_id,skill_id,outcome,item_type,item_id,title,href) values($1,$2,'demonstrated_strength','competition',$3,'Skill competition','/programs')", [user, skill, other]);
  assert.equal(Number((await db.query('select count(*) n from diagnostic_assignments where user_id=$1', [user])).rows[0].n), 1);
  await db.exec('set role authenticated');
  const call = async (name, args = []) => (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
  await assert.rejects(call('gifted_experience_state', [assignment]), /not assigned/);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  let state = await call('gifted_experience_state', [assignment]);
  assert.equal(state.currentStepId, 'start');
  await assert.rejects(call('complete_gifted_experience_step', [assignment, 'start']), /Submit the diagnostic/);
  const diagnosticAssignment = (await call('my_diagnostics'))[0].id;
  let diagnosticState = await call('learner_diagnostic', [diagnosticAssignment]);
  diagnosticState = await call('learner_diagnostic', [diagnosticAssignment, { q0: 0, q1: 0, q2: 0 }, diagnosticState.attempt.revision]);
  await call('submit_diagnostic', [diagnosticAssignment, diagnosticState.attempt.revision]);
  state = await call('gifted_experience_state', [assignment]);
  assert.equal(state.currentStepId, 'strength');
  assert.deepEqual(state.steps.map(step => step.id), ['start', 'strength']);
  assert.equal(state.recommendations[0].title, 'Skill competition');
  await assert.rejects(call('complete_gifted_experience_step', [assignment, 'develop']), /current stage/);
  state = await call('complete_gifted_experience_step', [assignment, 'strength']);
  assert.equal(state.isComplete, true);
  assert.equal((await call('my_gifted_experiences')).length, 1);
  await assert.rejects(db.exec("update gifted_experience_versions set snapshot='{}'"), /permission denied|immutable/);
  console.log('PASS migration rerun, assignment, diagnostic gate, ordered completion, resume state, ownership, immutable publication');
} finally { await db.close(); }
