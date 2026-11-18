// Explicitly opt-in: creates retained, labelled QA versions and assignments.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');

function envFile(path) {
  for (const line of fs.readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
}

async function main() {
  if (!process.argv.includes('--write-qa-record')) throw new Error('Pass --write-qa-record to create retained QA journey data.');
  const emailArg = process.argv.find(value => value.startsWith('--learner='));
  if (!emailArg) throw new Error('Pass --learner=<existing account email>.');
  envFile('.env.local');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: diagnostics, error: diagnosticError } = await db.from('diagnostics').select('*').order('updated_at', { ascending: false }).limit(200);
  if (diagnosticError) throw diagnosticError;
  const diagnostic = diagnostics.find(item => item.draft?.title?.startsWith('[QA TEST] Diagnostics verification'));
  assert(diagnostic, 'Run the diagnostics live QA setup first.');
  const { data: skills, error: skillError } = await db.from('track_skills').select('*').eq('track_id', diagnostic.track_id);
  if (skillError) throw skillError;
  const snapshot = { ...diagnostic.draft, skills: skills.filter(skill => diagnostic.draft.skillIds.includes(skill.id)), reportRulesVersion: 1 };
  const { data: diagnosticVersion, error: publishDiagnosticError } = await db.rpc('publish_diagnostic', { p_id: diagnostic.id, p_revision: diagnostic.revision, p_snapshot: snapshot, p_actor: 'gifted-experience-qa' });
  if (publishDiagnosticError) throw publishDiagnosticError;
  const stamp = new Date().toISOString();
  const journey = {
    title: `[QA TEST] Gifted Experience ${stamp}`,
    trackId: diagnostic.track_id,
    description: 'Browser verification of diagnostic gating, ordered unlocking, persistence, and completion.',
    steps: [
      { id: crypto.randomUUID(), type: 'diagnostic', title: 'Confirm my starting point', description: 'Complete the assigned diagnostic before the learning route unlocks.', href: '/diagnostics', diagnosticId: diagnostic.id, diagnosticVersion },
      { id: crypto.randomUUID(), type: 'resource', title: 'Review the learning checkpoint', description: 'QA stage: open the Learning Hub, then return and confirm completion.', href: '/learning-management' },
      { id: crypto.randomUUID(), type: 'practice', title: 'Try the practice checkpoint', description: 'QA stage: confirm that progress resumes at this point.', href: '/practice-overview' },
      { id: crypto.randomUUID(), type: 'competition', title: 'Review competition readiness', description: 'QA stage: complete the route and reveal competition opportunities.', href: '/programs' },
    ],
  };
  const { data: experience, error: insertError } = await db.from('gifted_experiences').insert({ track_id: journey.trackId, draft: journey }).select().single();
  if (insertError) throw insertError;
  const { data: journeyVersion, error: publishJourneyError } = await db.rpc('publish_gifted_experience', { p_id: experience.id, p_revision: experience.revision, p_snapshot: { ...journey, journeyRulesVersion: 1 }, p_actor: 'gifted-experience-qa' });
  if (publishJourneyError) throw publishJourneyError;
  const email = emailArg.slice('--learner='.length).toLowerCase();
  let learner;
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    learner = data.users.find(user => user.email?.toLowerCase() === email);
    if (learner || data.users.length < 1000) break;
  }
  assert(learner, 'Learner account not found.');
  const { data: assignment, error: assignmentError } = await db.rpc('assign_gifted_experience', { p_experience: experience.id, p_version: journeyVersion, p_user: learner.id });
  if (assignmentError) throw assignmentError;
  console.log(`PASS retained QA journey ${experience.id} v${journeyVersion}, diagnostic v${diagnosticVersion}, assignment ${assignment}`);
}

main().catch(error => { console.error(error.message || error); process.exitCode = 1; });
