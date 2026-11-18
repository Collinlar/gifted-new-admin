"use client";

import { useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';
import Button from '@/components/ui/Button';
import { emptyGiftedExperience, ExperienceOutcome, ExperienceStep, EXPERIENCE_OUTCOMES, EXPERIENCE_STEP_TYPES, GiftedExperienceDraft, publicationIssues } from '@/lib/giftedExperience';

type Track = { _id: string; name: string };
type Diagnostic = { id: string; draft: { title: string; trackId: string }; published_version: number | null };
type Saved = { id: string; draft: GiftedExperienceDraft; revision: number; published_version: number | null };
type Skill = { id: string; track_id: string; topic: string; name: string };
type TrackableItem = { id: string; type: 'course' | 'exam' | 'competition' | 'camp'; label: string; trackIds: string[] };
type Mapping = { id: string; skill_id: string; outcome: Exclude<ExperienceOutcome, 'always' | 'all_demonstrated_strength'>; item_type: TrackableItem['type']; item_id: string; title: string; description: string; href: string; priority: number; active: boolean };
const destinations: Record<string, string> = { resource: '/learning-management', practice: '/practice-overview', assessment: '/assessment-management', mock: '/assessment-management', competition: '/programs', camp: '/tracks' };
const outcomeLabels: Record<ExperienceOutcome, string> = { always: 'Always include', needs_development: 'Needs development', verify_skill: 'Verify this skill', demonstrated_strength: 'Demonstrated strength', insufficient_evidence: 'Insufficient evidence', all_demonstrated_strength: 'All measured skills are strengths' };
const mappedStepTypes: Record<TrackableItem['type'], ExperienceStep['type']> = { course: 'resource', exam: 'assessment', competition: 'competition', camp: 'camp' };
const field = 'mt-1 min-h-11 w-full rounded-lg border border-border bg-white px-3 py-2';
const message = (error: unknown) => (error as { response?: { data?: { error?: string } } })?.response?.data?.error || (error instanceof Error ? error.message : 'The action could not be completed.');

export default function GiftedExperiencesPage() {
  const [items, setItems] = useState<Saved[]>([]), [tracks, setTracks] = useState<Track[]>([]), [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]), [catalog, setCatalog] = useState<TrackableItem[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]), [mappings, setMappings] = useState<Mapping[]>([]);
  const [mappingForm, setMappingForm] = useState({ skillId: '', outcome: 'needs_development' as Mapping['outcome'], itemKey: '', description: '', priority: 100 });
  const [draft, setDraft] = useState<GiftedExperienceDraft | null>(null), [saved, setSaved] = useState<Saved | null>(null);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [learnerEmail, setLearnerEmail] = useState('');
  const eligibleDiagnostics = useMemo(() => diagnostics.filter(item => item.published_version && item.draft.trackId === draft?.trackId), [diagnostics, draft?.trackId]);
  const eligibleCatalog = useMemo(() => catalog.filter(item => draft?.trackId && item.trackIds.includes(draft.trackId)), [catalog, draft?.trackId]);
  const issues = draft ? publicationIssues(draft) : [];

  async function load() {
    setBusy(true); setError('');
    try {
      const [experienceResponse, trackResponse, diagnosticResponse, catalogResponse] = await Promise.all([api.get('/gifted-experiences'), api.get('/all-tracks'), api.get('/diagnostics'), api.get('/trackable-items')]);
      setItems(experienceResponse.data.experiences || []); setTracks(trackResponse.data.tracks || trackResponse.data.allTracks || []); setDiagnostics(diagnosticResponse.data.diagnostics || []); setCatalog(catalogResponse.data.items || []);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!draft?.trackId) { setSkills([]); setMappings([]); return; }
    api.get('/gifted-experiences', { params: { track: draft.trackId } }).then(response => {
      setSkills(response.data.skills || []); setMappings(response.data.mappings || []);
      setMappingForm(current => ({ ...current, skillId: response.data.skills?.some((skill: Skill) => skill.id === current.skillId) ? current.skillId : (response.data.skills?.[0]?.id || ''), itemKey: '' }));
    }).catch(e => setError(message(e)));
  }, [draft?.trackId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function open(item: Saved | null) {
    setError(''); setNotice(''); setLearnerEmail('');
    if (!item) { setSaved(null); setDraft(emptyGiftedExperience()); setDirty(false); return; }
    setBusy(true);
    try { const response = await api.get('/gifted-experiences', { params: { id: item.id } }); setSaved(response.data.experience); setDraft(response.data.experience.draft); setDirty(false); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  function change(next: Partial<GiftedExperienceDraft>) { setDraft(current => current ? { ...current, ...next } : current); setDirty(true); setNotice(''); }
  function changeStep(index: number, next: Partial<ExperienceStep>) {
    if (!draft) return;
    const steps = draft.steps.map((step, position) => position === index ? { ...step, ...next } : step);
    change({ steps });
  }
  function addStep() {
    if (!draft) return;
    const type = draft.steps.length ? 'resource' : 'diagnostic';
    const diagnostic = eligibleDiagnostics[0];
    change({ steps: [...draft.steps, { id: crypto.randomUUID(), type, title: type === 'diagnostic' ? (diagnostic?.draft.title || '') : '', description: '', href: type === 'diagnostic' ? '/diagnostics' : destinations[type], ...(type === 'diagnostic' && diagnostic ? { diagnosticId: diagnostic.id, diagnosticVersion: diagnostic.published_version || 1 } : {}) }] });
  }
  async function saveMapping() {
    if (!draft?.trackId) return;
    const [itemType, itemId] = mappingForm.itemKey.split(':') as [TrackableItem['type'], string];
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api.post('/gifted-experiences', { action: 'mapping', trackId: draft.trackId, skillId: mappingForm.skillId, outcome: mappingForm.outcome, itemType, itemId, description: mappingForm.description, priority: mappingForm.priority });
      setMappings(current => [...current.filter(item => item.id !== response.data.mapping.id), response.data.mapping].sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title)));
      setMappingForm(current => ({ ...current, itemKey: '', description: '' })); setNotice('Reusable skill recommendation saved.');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  function addMappedStep(mapping: Mapping) {
    if (!draft) return;
    change({ steps: [...draft.steps, { id: crypto.randomUUID(), type: mappedStepTypes[mapping.item_type], title: mapping.title, description: mapping.description, href: mapping.href, mappingId: mapping.id, condition: { outcome: mapping.outcome, skillId: mapping.skill_id } }] });
  }
  async function setMappingActive(mapping: Mapping, active: boolean) {
    setBusy(true); setError('');
    try { const response = await api.post('/gifted-experiences', { action: 'mapping-active', id: mapping.id, active }); setMappings(current => current.map(item => item.id === mapping.id ? response.data.mapping : item)); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function save() {
    if (!draft) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api.post('/gifted-experiences', { action: 'save', id: saved?.id, revision: saved?.revision, draft });
      setSaved(response.data.experience); setDirty(false); setItems(old => [response.data.experience, ...old.filter(item => item.id !== response.data.experience.id)]); setNotice('Gifted Experience draft saved.');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function publish() {
    if (!saved) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await api.post('/gifted-experiences', { action: 'publish', id: saved.id, revision: saved.revision });
      const next = { ...saved, revision: response.data.revision, published_version: response.data.version }; setSaved(next); setItems(old => old.map(item => item.id === next.id ? next : item)); setNotice(`Version ${response.data.version} published and ready to assign.`);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function assign() {
    if (!saved?.published_version) return;
    setBusy(true); setError(''); setNotice('');
    try { await api.post('/gifted-experiences', { action: 'assign', id: saved.id, version: saved.published_version, email: learnerEmail }); setNotice(`Published version ${saved.published_version} assigned to ${learnerEmail.trim()}.`); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  return <div className="space-y-6 p-6">
    <div><h1 className="text-3xl font-semibold text-ink">Gifted Experiences</h1><p className="mt-2 text-muted">Build the guided route while keeping Tracks available as the self-directed buffet.</p></div>
    {error && <div role="alert" className="border-l-4 border-danger bg-red-50 p-4 text-red-800">{error}</div>}
    {notice && <p role="status" className="border-l-4 border-primary bg-blue-50 p-4">{notice}</p>}
    {!draft ? <section className="rounded-xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5"><div><h2 className="text-xl font-semibold">Track journeys</h2><p className="text-muted">Each published version is fixed; later edits become a new version.</p></div><Button onClick={() => open(null)}>Create Gifted Experience</Button></div>
      {busy ? <p className="py-8">Loading Gifted Experiences...</p> : !items.length ? <p className="py-8 text-muted">No guided journeys yet.</p> : <div className="divide-y divide-border">{items.map(item => <button key={item.id} onClick={() => open(item)} className="flex min-h-20 w-full items-center justify-between gap-4 text-left"><span><strong className="block">{item.draft.title}</strong><span className="text-sm text-muted">{tracks.find(track => track._id === item.draft.trackId)?.name || 'Track'} · {item.draft.steps.length} stages</span></span><span className="text-sm">{item.published_version ? `Published v${item.published_version}` : 'Draft'} →</span></button>)}</div>}
    </section> : <section className="space-y-6 rounded-xl border border-border bg-white p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5"><Button variant="ghost" onClick={() => { if (!dirty || window.confirm('Discard unsaved changes?')) { setDraft(null); setSaved(null); } }}>← Journey library</Button><div className="flex items-center gap-3"><span className="text-sm text-muted">{dirty ? 'Unsaved changes' : saved ? 'Saved draft' : 'New draft'}</span><Button disabled={busy} onClick={save}>Save draft</Button></div></div>
      <div className="grid gap-4 md:grid-cols-2"><label>Journey title<input className={field} value={draft.title} onChange={event => change({ title: event.target.value })}/></label><label>Track<select className={field} value={draft.trackId} onChange={event => change({ trackId: event.target.value, steps: [] })}><option value="">Choose a track</option>{tracks.map(track => <option key={track._id} value={track._id}>{track.name}</option>)}</select></label></div>
      <label className="block">What this experience helps the learner achieve<textarea className={field} rows={3} value={draft.description} onChange={event => change({ description: event.target.value })}/></label>
      {!!draft.trackId && <div className="rounded-xl border border-border bg-slate-50 p-5"><div><h2 className="text-xl font-semibold">Skill content library</h2><p className="text-sm text-muted">Map tagged track content once, then reuse it as a recommendation or a result-driven journey stage.</p></div>
        {!skills.length ? <p className="mt-4 text-sm text-muted">Add topics and skills in Diagnostics before creating skill mappings.</p> : <><div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <label>Skill<select className={field} value={mappingForm.skillId} onChange={event => setMappingForm(current => ({ ...current, skillId: event.target.value }))}>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.topic} · {skill.name}</option>)}</select></label>
          <label>Diagnostic result<select className={field} value={mappingForm.outcome} onChange={event => setMappingForm(current => ({ ...current, outcome: event.target.value as Mapping['outcome'] }))}>{(['needs_development', 'verify_skill', 'demonstrated_strength', 'insufficient_evidence'] as Mapping['outcome'][]).map(outcome => <option key={outcome} value={outcome}>{outcomeLabels[outcome]}</option>)}</select></label>
          <label>Tagged content<select className={field} value={mappingForm.itemKey} onChange={event => setMappingForm(current => ({ ...current, itemKey: event.target.value }))}><option value="">Choose content</option>{eligibleCatalog.map(item => <option key={`${item.type}:${item.id}`} value={`${item.type}:${item.id}`}>{item.type} · {item.label}</option>)}</select></label>
          <label>Priority<input type="number" min="0" max="10000" className={field} value={mappingForm.priority} onChange={event => setMappingForm(current => ({ ...current, priority: Number(event.target.value) }))}/></label>
        </div><label className="mt-4 block">Recommendation guidance<textarea className={field} rows={2} value={mappingForm.description} onChange={event => setMappingForm(current => ({ ...current, description: event.target.value }))}/></label><div className="mt-3"><Button disabled={busy || !mappingForm.skillId || !mappingForm.itemKey} onClick={saveMapping}>Save reusable mapping</Button></div></>}
        {!!mappings.length && <div className="mt-5 divide-y divide-border border-t border-border">{mappings.map(mapping => <div key={mapping.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><span><strong className="block">{mapping.title}</strong><span className="text-sm text-muted">{skills.find(skill => skill.id === mapping.skill_id)?.name || 'Skill'} · {outcomeLabels[mapping.outcome]} · {mapping.item_type}{!mapping.active ? ' · inactive' : ''}</span></span><span className="flex gap-2"><Button size="sm" variant="ghost" disabled={!mapping.active} onClick={() => addMappedStep(mapping)}>Add to journey</Button><Button size="sm" variant="ghost" disabled={busy} onClick={() => setMappingActive(mapping, !mapping.active)}>{mapping.active ? 'Deactivate' : 'Reactivate'}</Button></span></div>)}</div>}
      </div>}
      <div><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Ordered stages</h2><p className="text-sm text-muted">The diagnostic is first. Each later stage unlocks after the current one is completed.</p></div><Button disabled={!draft.trackId || draft.steps.length >= 100} onClick={addStep}>Add stage</Button></div>
        <div className="mt-4 space-y-4">{draft.steps.map((step, index) => <article key={step.id} className="rounded-lg border border-border p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><strong>Stage {index + 1}</strong><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={!index} onClick={() => { const steps = [...draft.steps]; [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]]; change({ steps }); }}>↑</Button><Button size="sm" variant="ghost" disabled={index === draft.steps.length - 1} onClick={() => { const steps = [...draft.steps]; [steps[index + 1], steps[index]] = [steps[index], steps[index + 1]]; change({ steps }); }}>↓</Button><Button size="sm" variant="danger" onClick={() => change({ steps: draft.steps.filter((_, position) => position !== index) })}>Remove</Button></div></div>
          <div className="grid gap-4 md:grid-cols-2"><label>Stage type<select className={field} value={step.type} onChange={event => { const type = event.target.value as ExperienceStep['type']; const diagnostic = eligibleDiagnostics[0]; changeStep(index, { type, href: type === 'diagnostic' ? '/diagnostics' : destinations[type], diagnosticId: type === 'diagnostic' ? diagnostic?.id : undefined, diagnosticVersion: type === 'diagnostic' ? diagnostic?.published_version || undefined : undefined, title: type === 'diagnostic' && diagnostic ? diagnostic.draft.title : step.title, condition: type === 'diagnostic' ? undefined : step.condition, mappingId: undefined }); }}>{EXPERIENCE_STEP_TYPES.map(type => <option key={type} value={type}>{type[0].toUpperCase() + type.slice(1)}</option>)}</select></label>
            {step.type === 'diagnostic' ? <label>Published diagnostic<select className={field} value={`${step.diagnosticId || ''}:${step.diagnosticVersion || ''}`} onChange={event => { const [id, version] = event.target.value.split(':'); const item = eligibleDiagnostics.find(diagnostic => diagnostic.id === id); changeStep(index, { diagnosticId: id, diagnosticVersion: Number(version), title: item?.draft.title || step.title, href: '/diagnostics' }); }}><option value=":">Choose a diagnostic</option>{eligibleDiagnostics.map(item => <option key={item.id} value={`${item.id}:${item.published_version}`}>{item.draft.title} · v{item.published_version}</option>)}</select></label> : <label>Internal destination<input className={field} value={step.href} onChange={event => changeStep(index, { href: event.target.value })} placeholder="/learning-management"/></label>}
          </div>{step.type !== 'diagnostic' && <div className="mt-4 grid gap-4 md:grid-cols-2"><label>Include this stage when<select className={field} value={step.condition?.outcome || 'always'} onChange={event => { const outcome = event.target.value as ExperienceOutcome; changeStep(index, { condition: outcome === 'always' ? undefined : { outcome, skillId: outcome === 'all_demonstrated_strength' ? undefined : step.condition?.skillId }, mappingId: undefined }); }}>{EXPERIENCE_OUTCOMES.map(outcome => <option key={outcome} value={outcome}>{outcomeLabels[outcome]}</option>)}</select></label>{step.condition?.outcome && step.condition.outcome !== 'always' && step.condition.outcome !== 'all_demonstrated_strength' && <label>For skill (optional)<select className={field} value={step.condition.skillId || ''} onChange={event => changeStep(index, { condition: { outcome: step.condition!.outcome, skillId: event.target.value || undefined }, mappingId: undefined })}><option value="">Any measured skill</option>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.topic} · {skill.name}</option>)}</select></label>}</div>}<label className="mt-4 block">Stage title<input className={field} value={step.title} onChange={event => changeStep(index, { title: event.target.value })}/></label><label className="mt-4 block">Learner guidance<textarea className={field} rows={2} value={step.description} onChange={event => changeStep(index, { description: event.target.value })}/></label>
        </article>)}</div>
      </div>
      {!!issues.length && <div className="rounded-lg bg-amber-50 p-4"><strong>Before publishing</strong><ul className="mt-2 list-disc pl-5">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
      <div className="flex flex-wrap items-center gap-4 border-t border-border pt-5"><Button disabled={busy || dirty || !saved || !!issues.length} onClick={publish}>Publish fixed version</Button><p className="text-sm text-muted">Save first. Publishing never assigns the experience automatically.</p></div>
      {!!saved?.published_version && <div className="flex flex-wrap items-end gap-3 border-t border-border pt-5"><label className="min-w-72">Assign published v{saved.published_version}<input type="email" className={field} value={learnerEmail} onChange={event => setLearnerEmail(event.target.value)} placeholder="Learner account email"/></label><Button disabled={busy || !learnerEmail.trim()} onClick={assign}>Assign journey</Button></div>}
    </section>}
  </div>;
}
