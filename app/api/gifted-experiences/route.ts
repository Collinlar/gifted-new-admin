import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { bearerFrom, verifyToken } from '@/lib/adminToken';
import { GiftedExperienceDraft, publicationIssues, validateGiftedExperience } from '@/lib/giftedExperience';

const reply = (body: unknown, status = 200) => NextResponse.json(body, { status });
function failure(error: { code?: string; message?: string }) {
  if (['42P01', 'PGRST205', 'PGRST202'].includes(error.code || '')) return reply({ error: 'Gifted Experience storage is not installed. Apply gifted_experience_v1.sql and gifted_experience_routing_v2.sql.' }, 503);
  if (error.code === '40001') return reply({ error: 'This Gifted Experience changed in another session. Reload it.' }, 409);
  return reply({ error: error.message || 'Could not access Gifted Experience storage. Retry your request.' }, 500);
}

export async function GET(req: NextRequest) {
  if (!verifyToken(bearerFrom(req))) return reply({ error: 'Sign in to manage Gifted Experiences.' }, 401);
  const id = req.nextUrl.searchParams.get('id');
  if (id) {
    const { data, error } = await supabase.from('gifted_experiences').select('*').eq('id', id).maybeSingle();
    return error ? failure(error) : data ? reply({ experience: data }) : reply({ error: 'Gifted Experience not found.' }, 404);
  }
  const track = req.nextUrl.searchParams.get('track');
  if (track) {
    const [skills, mappings] = await Promise.all([
      supabase.from('track_skills').select('id,track_id,topic,name').eq('track_id', track).order('topic').order('name'),
      supabase.from('skill_content_mappings').select('*').eq('track_id', track).order('priority').order('title'),
    ]);
    if (skills.error) return failure(skills.error);
    if (mappings.error) return failure(mappings.error);
    return reply({ skills: skills.data || [], mappings: mappings.data || [] });
  }
  const { data, error } = await supabase.from('gifted_experiences').select('id,draft,revision,published_version,updated_at').order('updated_at', { ascending: false }).limit(200);
  return error ? failure(error) : reply({ experiences: data });
}

async function learnerByEmail(emailValue: unknown) {
  if (typeof emailValue !== 'string' || !emailValue.trim()) return undefined;
  const email = emailValue.trim().toLowerCase();
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const users = data.users as Array<{ id: string; email?: string }>;
    const learner = users.find(user => user.email?.toLowerCase() === email);
    if (learner) return learner;
    if (users.length < 1000) return undefined;
  }
}

async function diagnosticIssues(draft: GiftedExperienceDraft) {
  const diagnosticSteps = draft.steps.filter(step => step.type === 'diagnostic');
  for (const step of diagnosticSteps) {
    const { data, error } = await supabase.from('diagnostic_versions').select('snapshot').eq('diagnostic_id', step.diagnosticId).eq('version', step.diagnosticVersion).maybeSingle();
    if (error) throw error;
    if (!data) return [`${step.title}: choose an existing published diagnostic.`];
    if (data.snapshot.trackId !== draft.trackId) return [`${step.title}: the diagnostic must belong to the same track.`];
  }
  const conditionedSkills = [...new Set(draft.steps.map(step => step.condition?.skillId).filter(Boolean))] as string[];
  if (conditionedSkills.length) {
    const { data, error } = await supabase.from('track_skills').select('id').eq('track_id', draft.trackId).in('id', conditionedSkills);
    if (error) throw error;
    if ((data || []).length !== conditionedSkills.length) return ['Every result-conditioned stage must use a skill from the journey track.'];
  }
  return [];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const mappingOutcomes = ['needs_development', 'verify_skill', 'demonstrated_strength', 'insufficient_evidence'];
const mappedItems = {
  course: { table: 'courses', label: 'title', href: '/learning-management' },
  exam: { table: 'exams', label: 'title', href: '/assessment-management' },
  competition: { table: 'competitions', label: 'name', href: '/programs' },
  camp: { table: 'camps', label: 'name', href: '/tracks' },
} as const;

export async function POST(req: NextRequest) {
  const actor = verifyToken(bearerFrom(req));
  if (!actor) return reply({ error: 'Sign in to manage Gifted Experiences.' }, 401);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return reply({ error: 'Provide valid JSON.' }, 400); }
  try {
    if (body.action === 'mapping') {
      const trackId = String(body.trackId || ''), skillId = String(body.skillId || ''), itemId = String(body.itemId || '');
      const outcome = String(body.outcome || ''), itemType = String(body.itemType || '') as keyof typeof mappedItems;
      const item = mappedItems[itemType];
      if (![trackId, skillId, itemId].every(value => uuid.test(value)) || !mappingOutcomes.includes(outcome) || !item) return reply({ error: 'Choose a track skill, result, and tagged content item.' }, 400);
      const [{ data: skill, error: skillError }, { data: tag, error: tagError }, { data: content, error: contentError }] = await Promise.all([
        supabase.from('track_skills').select('id').eq('id', skillId).eq('track_id', trackId).maybeSingle(),
        supabase.from('track_items').select('item_id').eq('track_id', trackId).eq('item_type', itemType).eq('item_id', itemId).maybeSingle(),
        supabase.from(item.table).select(`id,${item.label}`).eq('id', itemId).maybeSingle(),
      ]);
      if (skillError) return failure(skillError);
      if (tagError) return failure(tagError);
      if (contentError) return failure(contentError);
      if (!skill || !tag || !content) return reply({ error: 'The skill and content must both belong to this track.' }, 400);
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const priority = Number.isInteger(body.priority) ? Number(body.priority) : 100;
      if (description.length > 2000 || priority < 0 || priority > 10000) return reply({ error: 'Keep guidance under 2,000 characters and priority between 0 and 10,000.' }, 400);
      const values = { track_id: trackId, skill_id: skillId, outcome, item_type: itemType, item_id: itemId, title: String(content[item.label as keyof typeof content]), description, href: item.href, priority, active: true, updated_at: new Date().toISOString() };
      const { data, error } = await supabase.from('skill_content_mappings').upsert(values, { onConflict: 'skill_id,outcome,item_type,item_id' }).select().single();
      return error ? failure(error) : reply({ mapping: data });
    }
    if (body.action === 'mapping-active') {
      if (!uuid.test(String(body.id || '')) || typeof body.active !== 'boolean') return reply({ error: 'Choose a valid content mapping.' }, 400);
      const { data, error } = await supabase.from('skill_content_mappings').update({ active: body.active, updated_at: new Date().toISOString() }).eq('id', body.id).select().maybeSingle();
      return error ? failure(error) : data ? reply({ mapping: data }) : reply({ error: 'Content mapping not found.' }, 404);
    }
    if (body.action === 'save') {
      const issues = validateGiftedExperience(body.draft);
      if (issues.length) return reply({ error: issues.join(' ') }, 400);
      const draft = body.draft as GiftedExperienceDraft;
      const referenceIssues = await diagnosticIssues(draft);
      if (referenceIssues.length) return reply({ error: referenceIssues.join(' ') }, 400);
      const values = { draft, track_id: draft.trackId, updated_at: new Date().toISOString() };
      if (!body.id) {
        const { data, error } = await supabase.from('gifted_experiences').insert(values).select().single();
        return error ? failure(error) : reply({ experience: data });
      }
      if (!Number.isInteger(body.revision)) return reply({ error: 'Reload this Gifted Experience before saving.' }, 400);
      const { data, error } = await supabase.from('gifted_experiences').update({ ...values, revision: Number(body.revision) + 1 }).eq('id', body.id).eq('revision', body.revision).select().maybeSingle();
      return error ? failure(error) : data ? reply({ experience: data }) : reply({ error: 'This Gifted Experience changed in another session. Reload it.' }, 409);
    }
    if (body.action === 'publish') {
      const { data: item, error } = await supabase.from('gifted_experiences').select('*').eq('id', body.id).maybeSingle();
      if (error) return failure(error);
      if (!item) return reply({ error: 'Gifted Experience not found.' }, 404);
      if (item.revision !== body.revision) return reply({ error: 'This Gifted Experience changed. Reload it before publishing.' }, 409);
      const draft = item.draft as GiftedExperienceDraft;
      const issues = [...publicationIssues(draft), ...(await diagnosticIssues(draft))];
      if (issues.length) return reply({ error: issues.join(' ') }, 400);
      const { data: version, error: publishError } = await supabase.rpc('publish_gifted_experience', { p_id: body.id, p_revision: body.revision, p_snapshot: { ...draft, journeyRulesVersion: 2 }, p_actor: actor.email });
      return publishError ? failure(publishError) : reply({ version, revision: item.revision + 1 });
    }
    if (body.action === 'assign') {
      if (!body.id || !Number.isInteger(body.version)) return reply({ error: 'Choose a published Gifted Experience.' }, 400);
      const learner = await learnerByEmail(body.email);
      if (!learner) return reply({ error: 'No learner account matches that email.' }, 404);
      const { data: assignmentId, error } = await supabase.rpc('assign_gifted_experience', { p_experience: body.id, p_version: body.version, p_user: learner.id });
      return error ? failure(error) : reply({ assigned: true, assignmentId });
    }
  } catch (error) { return failure(error as { code?: string; message?: string }); }
  return reply({ error: 'Unknown Gifted Experience action.' }, 400);
}
