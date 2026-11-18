import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { bearerFrom, verifyToken } from '@/lib/adminToken';
import { publicationIssues, validateDraft, DiagnosticDraft, Skill } from '@/lib/diagnostics';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status });
function failure(error: { code?: string }) {
  if (['42P01', 'PGRST205', 'PGRST202'].includes(error.code || '')) return reply({ error: 'Diagnostics storage is not installed. Apply supabase/diagnostics_v1.sql.' }, 503);
  if (error.code === '23505') return reply({ error: 'This skill already exists in the selected topic.' }, 409);
  if (error.code === '40001') return reply({ error: 'This diagnostic changed in another session. Reload before publishing.' }, 409);
  return reply({ error: 'Could not access diagnostics storage. Retry your request.' }, 500);
}
export async function GET(req: NextRequest) {
  if (!verifyToken(bearerFrom(req))) return reply({ error: 'Sign in to manage diagnostics.' }, 401);
  const track = req.nextUrl.searchParams.get('track');
  const id = req.nextUrl.searchParams.get('id');
  if (track) {
    const { data, error } = await supabase.from('track_skills').select('*').eq('track_id', track).order('topic').order('name').limit(1000);
    return error ? failure(error) : reply({ skills: data });
  }
  if (id) {
    const { data, error } = await supabase.from('diagnostics').select('*').eq('id', id).maybeSingle();
    return error ? failure(error) : data ? reply({ diagnostic: data }) : reply({ error: 'Diagnostic not found.' }, 404);
  }
  const { data, error } = await supabase.from('diagnostics').select('id, draft, revision, published_version, updated_at').order('updated_at', { ascending: false }).limit(200);
  return error ? failure(error) : reply({ diagnostics: data });
}
export async function POST(req: NextRequest) {
  const actor = verifyToken(bearerFrom(req));
  if (!actor) return reply({ error: 'Sign in to manage diagnostics.' }, 401);
  let body;
  try { body = await req.json(); } catch { return reply({ error: 'Provide valid JSON.' }, 400); }
  if (!body || typeof body !== 'object') return reply({ error: 'Provide a diagnostic action.' }, 400);
  if (body.action === 'assign') {
    if (!body.id || !Number.isInteger(body.version) || typeof body.email !== 'string') return reply({ error: 'Choose a published version and learner email.' }, 400);
    const { data: version, error } = await supabase.from('diagnostic_versions').select('snapshot').eq('diagnostic_id', body.id).eq('version', body.version).maybeSingle();
    if (error) return failure(error);
    if (!version) return reply({ error: 'Published version not found.' }, 404);
    // Resolve an existing auth account without creating or changing accounts.
    const email = body.email.trim().toLowerCase();
    let learner: { id: string } | undefined;
    for (let page = 1; ; page++) {
      const { data, error: authError } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
      if (authError) return failure(authError);
      const users = data.users as Array<{ id: string; email?: string }>;
      learner = users.find(u => u.email?.toLowerCase() === email);
      if (learner || users.length < 1000) break;
    }
    if (!learner) return reply({ error: 'No learner account matches that email.' }, 404);
    const { error: assignError } = await supabase.from('diagnostic_assignments').upsert({ diagnostic_id: body.id, version: body.version, track_id: version.snapshot.trackId, user_id: learner.id, active: true }, { onConflict: 'diagnostic_id,version,user_id' });
    return assignError ? failure(assignError) : reply({ assigned: true });
  }
  if (body.action === 'skill') {
    if (typeof body.trackId !== 'string' || typeof body.topic !== 'string' || typeof body.name !== 'string' || !body.topic.trim() || !body.name.trim() || body.topic.length > 200 || body.name.length > 200) return reply({ error: 'Choose a track and provide a topic and skill, each up to 200 characters.' }, 400);
    const { data, error } = await supabase.from('track_skills').insert({ track_id: body.trackId, topic: body.topic.trim(), name: body.name.trim() }).select().single();
    return error ? failure(error) : reply({ skill: data });
  }
  if (body.action === 'save') {
    const issues = validateDraft(body.draft);
    if (issues.length) return reply({ error: issues.join(' ') }, 400);
    const draft = body.draft as DiagnosticDraft;
    const { data: skills, error: skillsError } = await supabase.from('track_skills').select('*').eq('track_id', draft.trackId);
    if (skillsError) return failure(skillsError);
    if (draft.skillIds.some(id => !skills.some(s => s.id === id))) return reply({ error: 'Selected skills must belong to this track.' }, 400);
    const values = { draft, track_id: draft.trackId, updated_at: new Date().toISOString() };
    if (!body.id) {
      const { data, error } = await supabase.from('diagnostics').insert(values).select().single();
      return error ? failure(error) : reply({ diagnostic: data });
    }
    if (!Number.isInteger(body.revision)) return reply({ error: 'Reload this diagnostic before saving.' }, 400);
    const { data, error } = await supabase.from('diagnostics').update({ ...values, revision: body.revision + 1 }).eq('id', body.id).eq('revision', body.revision).select().maybeSingle();
    return error ? failure(error) : data ? reply({ diagnostic: data }) : reply({ error: 'This diagnostic changed in another session. Reload before saving.' }, 409);
  }
  if (body.action === 'publish') {
    const { data: item, error } = await supabase.from('diagnostics').select('*').eq('id', body.id).maybeSingle();
    if (error) return failure(error);
    if (!item) return reply({ error: 'Diagnostic not found.' }, 404);
    if (item.revision !== body.revision) return reply({ error: 'This diagnostic changed. Reload before publishing.' }, 409);
    const draft = item.draft as DiagnosticDraft;
    const { data: skills, error: skillError } = await supabase.from('track_skills').select('*').eq('track_id', item.track_id);
    if (skillError) return failure(skillError);
    const issues = publicationIssues(draft, skills as Skill[]);
    if (issues.length) return reply({ error: issues.join(' ') }, 400);
    const snapshot = { ...draft, skills: skills.filter(s => draft.skillIds.includes(s.id)), reportRulesVersion: 1 };
    const { data: version, error: publishError } = await supabase.rpc('publish_diagnostic', { p_id: body.id, p_revision: body.revision, p_snapshot: snapshot, p_actor: actor.email });
    return publishError ? failure(publishError) : reply({ version, revision: item.revision + 1 });
  }
  return reply({ error: 'Unknown diagnostic action.' }, 400);
}
