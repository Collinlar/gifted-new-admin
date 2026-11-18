// Explicitly opt-in: creates a labelled QA skill and diagnostic in the configured
// database. Published snapshots are immutable, so the QA diagnostic is retained.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });

async function main() {
  if (!process.argv.includes('--write-qa-record')) throw new Error('Pass --write-qa-record to explicitly create a retained QA diagnostic.');
  const base = process.env.DIAGNOSTICS_TEST_URL || 'http://localhost:3010';
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error('Live smoke tests must use a local admin server.');
  const moduleExports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/adminToken.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, { exports: moduleExports, require, process, Buffer });
  const token = moduleExports.issueToken('diagnostics-qa@example.test');
  assert.ok(token, 'Local signing configuration is available');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_SERVICE_ROLE, { auth: { persistSession: false } });
  let handlers;
  if (process.argv.includes('--in-process')) {
    const rules = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/diagnostics.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: rules });
    handlers = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/api/diagnostics/route.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
      exports: handlers, require: name => name === '@/lib/supabase' ? { supabase: db } : name === '@/lib/adminToken' ? moduleExports : name === '@/lib/diagnostics' ? rules : require(name),
    });
    console.log('Testing actual Next route handlers in-process against live Supabase.');
  }
  async function request(path, body, expected = 200, authenticated = true) {
    const init = { method: body ? 'POST' : 'GET',
      headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) };
    const response = handlers ? await handlers[body ? 'POST' : 'GET'](new (require('next/server').NextRequest)(base + path, init)) : await fetch(base + path, init);
    const result = await response.json();
    assert.equal(response.status, expected, `${path}: ${JSON.stringify(result).slice(0, 400)}`);
    return result;
  }
  await request('/api/diagnostics', null, 401, false);
  await request('/api/diagnostics', { action: 'save' }, 401, false);
  const initial = await request('/api/diagnostics');
  console.log(`PASS authenticated library reads migrated storage (${initial.diagnostics.length} existing diagnostics); unauthenticated reads/writes rejected`);
  const trackResult = handlers ? await db.from('tracks').select('id,name').order('name') : null;
  if (trackResult) assert.ifError(trackResult.error);
  const tracks = handlers ? trackResult.data.map(t => ({ ...t, _id: t.id })) : (await request('/api/all-tracks')).tracks;
  const track = tracks.find(t => /math/i.test(t.name)) || tracks[0];
  assert.ok(track, 'At least one track exists');
  const label = `QA smoke test ${new Date().toISOString()}`;
  const { skill } = await request('/api/diagnostics', { action: 'skill', trackId: track._id, topic: 'QA diagnostics testing', name: label });
  const skillRead = await request(`/api/diagnostics?track=${track._id}`);
  assert.ok(skillRead.skills.some(s => s.id === skill.id));
  await request('/api/diagnostics', { action: 'skill', trackId: track._id, topic: 'QA diagnostics testing', name: label }, 409);
  const draft = { title: `[QA TEST] Diagnostics verification ${label.slice(14)}`, trackId: track._id, audience: 'Administrator QA only; not learner content', instructions: 'Test fixture for diagnostic authoring and publication.', skillIds: [skill.id], minimumEvidence: 3, targetPercent: 75, questions: [] };
  let { diagnostic } = await request('/api/diagnostics', { action: 'save', draft });
  console.log(`QA diagnostic retained: ${diagnostic.id}`);
  await request('/api/diagnostics', { action: 'publish', id: diagnostic.id, revision: diagnostic.revision }, 400);
  draft.questions = ['beginner', 'intermediate', 'advanced'].map((difficulty, i) => ({ id: `qa-${i}`, prompt: `QA arithmetic check ${i + 1}: what is ${i + 1} + 1?`, options: [String(i + 2), '0', '10', '20'], correctIndex: 0, skillId: skill.id, difficulty, explanation: `Adding one to ${i + 1} gives ${i + 2}.` }));
  ({ diagnostic } = await request('/api/diagnostics', { action: 'save', id: diagnostic.id, revision: diagnostic.revision, draft }));
  const reloaded = await request(`/api/diagnostics?id=${diagnostic.id}`);
  assert.deepEqual(reloaded.diagnostic.draft, draft);
  await request('/api/diagnostics', { action: 'save', id: diagnostic.id, revision: diagnostic.revision - 1, draft }, 409);
  console.log('PASS skill creation/reload, duplicate rejection, draft save/reload, incomplete publication rejection, and stale edit conflict');
  const published = await request('/api/diagnostics', { action: 'publish', id: diagnostic.id, revision: diagnostic.revision });
  assert.equal(published.version, 1);
  await request('/api/diagnostics', { action: 'publish', id: diagnostic.id, revision: diagnostic.revision }, 409);
  const { data: versions, error } = await db.from('diagnostic_versions').select('version,snapshot').eq('diagnostic_id', diagnostic.id);
  assert.ifError(error);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].snapshot.questions.length, 3);
  assert.equal(versions[0].snapshot.skills[0].id, skill.id);
  assert.equal(versions[0].snapshot.reportRulesVersion, 1);
  const edited = { ...draft, instructions: 'Edited QA draft. The first published version must remain fixed.' };
  await request('/api/diagnostics', { action: 'save', id: diagnostic.id, revision: published.revision, draft: edited });
  const { data: snapshot, error: readError } = await db.from('diagnostic_versions').select('snapshot').eq('diagnostic_id', diagnostic.id).eq('version', 1).single();
  assert.ifError(readError);
  assert.deepEqual(snapshot.snapshot, versions[0].snapshot);
  console.log('PASS live atomic publication, stale publish conflict, frozen skill/question snapshot, and later draft isolation');
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (publicKey) {
    const publicDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, publicKey, { auth: { persistSession: false } });
    for (const table of ['diagnostics', 'diagnostic_versions', 'track_skills']) {
      const result = await publicDb.from(table).select('*').limit(1);
      assert.ok(result.error || result.data.length === 0, `Public access must not expose ${table}`);
    }
    console.log('PASS anonymous database access exposes no diagnostic answer keys');
  }
  console.log('PASS LIVE DIAGNOSTICS SMOKE TEST');
}
main().catch(error => { console.error('FAIL:', error.message, error.cause?.code || '', error.cause?.message || ''); process.exitCode = 1; });
