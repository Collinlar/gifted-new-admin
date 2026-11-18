"use client";

import { useEffect, useRef, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import DashboardShell from '@/components/layout/DashboardShell';
import Button from '@/components/ui/Button';
import api from '@/lib/api';
import { DiagnosticDraft, DiagnosticQuestion, Skill, LEVELS, emptyDiagnostic, publicationIssues, diagnosticReport } from '@/lib/diagnostics';

type Saved = { id: string; draft: DiagnosticDraft; revision: number; published_version: number };
type Track = { _id: string; name: string };
const field = 'w-full min-h-11 rounded border border-border bg-white px-3 py-2 text-base text-ink';
const blankQuestion = (): DiagnosticQuestion => ({ id: crypto.randomUUID(), prompt: '', options: ['', '', '', ''], correctIndex: 0, skillId: '', difficulty: 'beginner', explanation: '' });
function message(e: unknown) { return (e as { response?: { data?: { error?: string } } })?.response?.data?.error || (e instanceof Error ? e.message : 'Could not save your diagnostic. Retry the action.'); }

export default function DiagnosticsPage() {
  const [items, setItems] = useState<Saved[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [draft, setDraft] = useState<DiagnosticDraft | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [topic, setTopic] = useState('');
  const [skillName, setSkillName] = useState('');
  const [tab, setTab] = useState<'setup' | 'questions' | 'review'>('setup');
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [showReport, setShowReport] = useState(false);
  const [sources, setSources] = useState<{ _id: string; title: string }[] | null>(null);
  const [source, setSource] = useState('');
  const [learnerEmail, setLearnerEmail] = useState('');
  async function assign() {
    setBusy(true); setError('');
    try { await api.post('/diagnostics', { action: 'assign', id: saved.id, version: saved.published_version, email: learnerEmail }, { timeout: 30000 }); setNotice(`Published version ${saved.published_version} assigned to ${learnerEmail}.`); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const fileInput = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true); setError('');
    const results = await Promise.allSettled([api.get('/diagnostics', { timeout: 15000 }), api.get('/all-tracks', { timeout: 15000 })]);
    if (results[0].status === 'fulfilled') setItems(results[0].value.data.diagnostics || []);
    else setError(message(results[0].reason));
    if (results[1].status === 'fulfilled') setTracks(results[1].value.data.tracks || []);
    else setError(message(results[1].reason));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (!draft?.trackId) { setSkills([]); return; }
    let active = true;
    setSkills([]);
    api.get('/diagnostics', { params: { track: draft.trackId }, timeout: 15000 }).then(r => { if (active) setSkills(r.data.skills); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [draft?.trackId]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    const intercept = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest('a');
      if (dirty && link?.href && !window.confirm('Leave this diagnostic and discard unsaved changes?')) { event.preventDefault(); event.stopPropagation(); }
    };
    document.addEventListener('click', intercept, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', intercept, true); };
  }, [dirty]);
  function change(patch: Partial<DiagnosticDraft>) { setDraft(d => d && ({ ...d, ...patch })); setDirty(true); setNotice(''); setShowReport(false); }
  function question(id: string, patch: Partial<DiagnosticQuestion>) { change({ questions: draft!.questions.map(q => q.id === id ? { ...q, ...patch } : q) }); setAnswers({}); }
  function open(item: Saved | null) { setSaved(item); setDraft(item?.draft || emptyDiagnostic()); setDirty(false); setTab('setup'); setAnswers({}); setShowReport(false); setError(''); setNotice(''); }
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await api.post('/diagnostics', { action: 'save', id: saved?.id, revision: saved?.revision, draft }, { timeout: 15000 });
      setSaved(r.data.diagnostic); setDirty(false);
      setItems(old => [r.data.diagnostic, ...old.filter(i => i.id !== r.data.diagnostic.id)]);
      setNotice('Diagnostic draft saved.');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function publish() {
    if (!saved || dirty) return;
    setBusy(true); setError('');
    try {
      const r = await api.post('/diagnostics', { action: 'publish', id: saved.id, revision: saved.revision }, { timeout: 15000 });
      const next = { ...saved, revision: r.data.revision, published_version: r.data.version };
      setSaved(next); setItems(old => old.map(i => i.id === next.id ? next : i));
      setNotice(`Version ${r.data.version} published. This version is fixed and ready for future journey integration.`);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function addSkill() {
    setBusy(true); setError('');
    try {
      const r = await api.post('/diagnostics', { action: 'skill', trackId: draft!.trackId, topic, name: skillName }, { timeout: 15000 });
      setSkills(old => [...old, r.data.skill]); change({ skillIds: [...draft!.skillIds, r.data.skill.id] }); setSkillName('');
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function loadSources() {
    setBusy(true); setError('');
    try { const r = await api.get('/all-exams-admin', { timeout: 15000 }); setSources(r.data.allExaminations || []); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function copyQuestions() {
    setBusy(true); setError('');
    try {
      const r = await api.get(`/all-exams/${source}`, { timeout: 15000 });
      const original = r.data.exam?.questions || [];
      // Refuse unsupported shapes instead of silently losing images or answer keys.
      const copied = original.map((q: { question: string; answers: string[]; correctAnswer: string; explanation?: string; image?: string }) => {
        if (q.image || typeof q.question !== 'string' || !Array.isArray(q.answers) || q.answers.some(a => typeof a !== 'string') || !q.answers.includes(q.correctAnswer)) throw new Error('This assessment contains images or unsupported answer formats. Add those questions manually after reviewing the original. No questions were copied.');
        return { ...blankQuestion(), prompt: q.question, options: [...q.answers], correctIndex: q.answers.indexOf(q.correctAnswer), explanation: q.explanation || '' };
      });
      if (!copied.length) throw new Error('This assessment has no questions to copy.');
      if (draft!.questions.length + copied.length > 500) throw new Error('A diagnostic supports up to 500 questions.');
      change({ questions: [...draft!.questions, ...copied] });
      setNotice(`Copied ${copied.length} independent questions. Assign skills and review each difficulty before publishing.`);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function importFile(file?: File) {
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Choose a spreadsheet smaller than 5 MB.');
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], { defval: '', raw: false });
      if (!rows.length || rows.length + draft!.questions.length > 500) throw new Error('Import between 1 and 500 questions in total.');
      const imported = rows.map((row, index) => {
        const skill = skills.find(s => s.topic.toLowerCase() === String(row.topic).trim().toLowerCase() && s.name.toLowerCase() === String(row.skill).trim().toLowerCase());
        const difficulty = String(row.difficulty).trim().toLowerCase() as DiagnosticQuestion['difficulty'];
        const options = ['option_a', 'option_b', 'option_c', 'option_d'].map(k => String(row[k] || '').trim());
        const correctIndex = ['A', 'B', 'C', 'D'].indexOf(String(row.correct_answer).trim().toUpperCase());
        if (!skill || !draft!.skillIds.includes(skill.id) || !LEVELS.includes(difficulty) || options.some(o => !o) || correctIndex < 0 || !row.question || !row.explanation) throw new Error(`Row ${index + 2}: use a selected topic/skill, a valid difficulty, four options, correct_answer A-D, a question, and an explanation. No rows were imported.`);
        return { id: crypto.randomUUID(), prompt: row.question, options, correctIndex, skillId: skill.id, difficulty, explanation: row.explanation };
      });
      change({ questions: [...draft!.questions, ...imported] }); setNotice(`Imported ${imported.length} questions. Review coverage before publishing.`);
    } catch (e) { setError(message(e)); } finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  const issues = draft ? publicationIssues(draft, skills) : [];
  return <AuthGuard><DashboardShell title="Diagnostics">
    <div className="max-w-6xl space-y-6 text-base">
      {error && <div role="alert" className="border-l-4 border-danger bg-red-50 p-4 text-red-800">{error} {!draft && <Button variant="ghost" onClick={load}>Retry diagnostics</Button>}</div>}
      {notice && <p role="status" className="border-l-4 border-primary bg-teal-50 p-4">{notice}</p>}
      {!draft ? <>
        <div className="flex flex-wrap justify-between gap-4 border-b border-border pb-6"><div><h2 className="text-2xl font-semibold">Understand where learning begins</h2><p className="mt-2 max-w-2xl text-muted">Build track-specific diagnostics around the skills you want learners to demonstrate.</p></div><Button onClick={() => open(null)}>Create diagnostic</Button></div>
        {loading ? <p>Reading your diagnostic library...</p> : !items.length ? <p className="py-10 text-muted">Your first diagnostic starts with a track, its topics, and the skills you want to measure.</p> : <div className="divide-y divide-border">{items.map(item => <button key={item.id} onClick={() => open(item)} className="flex min-h-20 w-full flex-wrap items-center justify-between gap-3 py-5 text-left hover:bg-surface"><span><strong className="block">{item.draft.title}</strong><span className="text-sm text-muted">{tracks.find(t => t._id === item.draft.trackId)?.name} · {item.draft.audience || 'Audience not set'} · {item.draft.questions.length} questions</span></span><span className="text-sm">{item.published_version ? `Published v${item.published_version} · editable draft` : 'Draft'} →</span></button>)}</div>}
      </> : <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button disabled={busy} variant="ghost" onClick={() => { if (!dirty || window.confirm('Discard unsaved changes and return to diagnostics?')) { setDraft(null); setDirty(false); setError(''); setNotice(''); } }}>← Diagnostic library</Button>
          <div className="flex items-center gap-3"><span className="text-sm text-muted">{dirty ? 'Unsaved changes' : saved ? `Saved draft${saved.published_version ? ` · published v${saved.published_version}` : ''}` : 'New draft'}</span><Button disabled={busy} onClick={save}>{busy ? 'Working on your diagnostic...' : 'Save draft'}</Button></div>
        </div>
        <div className="flex flex-wrap gap-2 border-b border-border pb-3" role="tablist" aria-label="Diagnostic builder">{(['setup', 'questions', 'review'] as const).map(t => <Button key={t} role="tab" aria-selected={tab === t} variant={tab === t ? 'primary' : 'ghost'} onClick={() => setTab(t)}>{t === 'setup' ? 'Audience and skills' : t === 'questions' ? `Questions (${draft.questions.length})` : 'Coverage and preview'}</Button>)}</div>
        <fieldset disabled={busy} className="min-w-0 space-y-6">
        {!!saved?.published_version && <div className="flex flex-wrap items-end gap-3 border-b border-border pb-4"><label>Assign published v{saved.published_version} to a learner<input type="email" className={field} value={learnerEmail} onChange={e => setLearnerEmail(e.target.value)} placeholder="Learner account email" /></label><Button disabled={!learnerEmail.trim()} onClick={assign}>Assign diagnostic</Button><p className="text-sm text-muted">Uses the published version, including its audience. Draft edits are not included.</p></div>}
        {tab === 'setup' && <>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="space-y-2">Diagnostic title<input className={field} value={draft.title} onChange={e => change({ title: e.target.value })} /></label>
            <label className="space-y-2">Track<select className={field} value={draft.trackId} onChange={e => { if ((draft.skillIds.length || draft.questions.length) && !window.confirm('Change track? Skill selections and question skill assignments will be cleared.')) return; change({ trackId: e.target.value, skillIds: [], questions: draft.questions.map(q => ({ ...q, skillId: '' })) }); }}><option value="">Choose a track</option>{tracks.map(t => <option key={t._id} value={t._id}>{t.name}</option>)}</select></label>
            <label className="space-y-2">Intended grade or audience<input className={field} placeholder="For example, learners in Basic 7 preparing for olympiad mathematics" value={draft.audience} onChange={e => change({ audience: e.target.value })} /></label>
            <label className="space-y-2">Learner instructions<textarea className={field} value={draft.instructions} onChange={e => change({ instructions: e.target.value })} /></label>
          </div>
          <div className="border-t border-border pt-5"><h2 className="text-xl font-semibold">Skills this diagnostic will measure</h2><p className="my-2 text-muted">Skills belong to the track and can be reused by other diagnostics. Select each skill you intend to report on.</p>
            {!draft.trackId ? <p>Choose a track to define its skills.</p> : <>
              <div className="divide-y divide-border">{skills.map(s => <label key={s.id} className="flex min-h-12 items-center gap-3 py-2"><input type="checkbox" className="h-5 w-5" checked={draft.skillIds.includes(s.id)} onChange={e => change({ skillIds: e.target.checked ? [...draft.skillIds, s.id] : draft.skillIds.filter(id => id !== s.id) })} /><span><span className="text-muted">{s.topic} / </span>{s.name}</span></label>)}</div>
              <div className="mt-4 grid items-end gap-3 md:grid-cols-[1fr_2fr_auto]"><label>Topic<input className={field} maxLength={200} value={topic} onChange={e => setTopic(e.target.value)} placeholder="Fractions" /></label><label>Specific skill<input className={field} maxLength={200} value={skillName} onChange={e => setSkillName(e.target.value)} placeholder="Compare fractions with different denominators" /></label><Button disabled={!topic.trim() || !skillName.trim()} onClick={addSkill}>Add track skill</Button></div>
            </>}
          </div>
          <div className="grid gap-4 border-t border-border pt-5 md:grid-cols-2"><label>Minimum answered questions per skill<input type="number" min={3} max={30} className={field} value={draft.minimumEvidence} onChange={e => change({ minimumEvidence: Number(e.target.value) })} /></label><label>Demonstrated strength target (%)<input type="number" min={1} max={100} className={field} value={draft.targetPercent} onChange={e => change({ targetPercent: Number(e.target.value) })} /></label></div>
          <p className="text-sm text-muted">Initial report rules require evidence at all three difficulty levels. Mixed results prompt verification. These configurable targets are not a certification of mastery.</p>
        </>}
        {tab === 'questions' && <>
          <div className="flex flex-wrap gap-3"><Button disabled={draft.questions.length >= 500} onClick={() => change({ questions: [...draft.questions, { ...blankQuestion(), skillId: draft.skillIds[0] || '' }] })}>Add question</Button><Button variant="secondary" onClick={loadSources}>Copy from an assessment</Button><Button variant="secondary" onClick={() => fileInput.current?.click()}>Import CSV or Excel</Button><a className="flex min-h-11 items-center text-primary underline" href="/diagnostic-question-template.csv" download>Download import template</a><input aria-label="Diagnostic question spreadsheet" ref={fileInput} className="hidden" type="file" accept=".csv,.xlsx,.xls" onChange={e => importFile(e.target.files?.[0])} /></div>
          <p className="text-sm text-muted">For spreadsheet imports, create and select the matching topics and skills first. Question difficulty is relative to your chosen audience.</p>
          {sources && <div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1">Source assessment<select className={field} value={source} onChange={e => setSource(e.target.value)}><option value="">Choose an assessment to copy</option>{sources.map(s => <option key={s._id} value={s._id}>{s.title}</option>)}</select></label><Button variant="secondary" disabled={!source} onClick={copyQuestions}>Copy independent questions</Button></div>}
          {!draft.questions.length && <p className="py-8 text-muted">Add questions to measure your selected skills at beginner, intermediate, and advanced levels.</p>}
          {draft.questions.map((q, i) => <section key={q.id} className="space-y-4 border-t border-border pt-5">
            <div className="flex justify-between gap-3"><h3 className="text-lg font-semibold">Question {i + 1}</h3><Button variant="ghost" onClick={() => { if (window.confirm(`Remove question ${i + 1} from this draft?`)) change({ questions: draft.questions.filter(x => x.id !== q.id) }); }}>Remove question</Button></div>
            <label className="block">Question text<textarea className={field} rows={3} value={q.prompt} onChange={e => question(q.id, { prompt: e.target.value })} /></label>
            <div className="grid gap-3 md:grid-cols-2"><label>Skill<select className={field} value={q.skillId} onChange={e => question(q.id, { skillId: e.target.value })}><option value="">Assign a selected skill</option>{skills.filter(s => draft.skillIds.includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.topic} / {s.name}</option>)}</select></label><label>Difficulty<select className={field} value={q.difficulty} onChange={e => question(q.id, { difficulty: e.target.value as DiagnosticQuestion['difficulty'] })}>{LEVELS.map(l => <option key={l} value={l}>{l}</option>)}</select></label></div>
            <fieldset className="space-y-2"><legend className="mb-2">Answer options and correct answer</legend>{q.options.map((option, index) => <div key={index} className="flex items-center gap-3"><label className="flex min-h-11 items-center gap-2"><input type="radio" name={`correct-${q.id}`} aria-label={`Option ${String.fromCharCode(65 + index)} is correct`} checked={q.correctIndex === index} onChange={() => question(q.id, { correctIndex: index })} className="h-5 w-5" />{String.fromCharCode(65 + index)}</label><input aria-label={`Question ${i + 1} option ${String.fromCharCode(65 + index)}`} className={field} value={option} onChange={e => question(q.id, { options: q.options.map((o, j) => j === index ? e.target.value : o) })} /></div>)}</fieldset>
            <label className="block">Answer explanation<textarea className={field} rows={2} value={q.explanation} onChange={e => question(q.id, { explanation: e.target.value })} /></label>
          </section>)}
        </>}
        {tab === 'review' && <>
          <h2 className="text-xl font-semibold">Coverage before publication</h2>
          {draft.skillIds.map(id => { const s = skills.find(s => s.id === id); return <div key={id} className="flex flex-wrap justify-between gap-3 border-b border-border pb-3"><strong>{s ? `${s.topic} / ${s.name}` : 'Skill unavailable'}</strong><span>{LEVELS.map(l => `${l}: ${draft.questions.filter(q => q.skillId === id && q.difficulty === l).length}`).join(' · ')}</span></div>; })}
          {issues.length ? <div className="border-l-4 border-amber-500 bg-amber-50 p-4"><p className="font-semibold">Resolve these items before publishing</p><ul className="mt-2 list-disc space-y-1 pl-5">{issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div> : <p className="text-primary">Every selected skill has the required question coverage.</p>}
          <div className="flex flex-wrap items-center gap-4"><Button disabled={!!issues.length || !saved || dirty} onClick={publish}>Publish fixed version</Button><p className="text-sm text-muted">Save your draft before publishing. Publishing here creates a version for journey integration; it does not enrol learners.</p></div>
          <div className="border-t border-border pt-6"><h2 className="text-xl font-semibold">Try the diagnostic and preview its report</h2><p className="mt-2 text-muted">Preview only. These answers are not saved as learner results.</p><p className="my-4 whitespace-pre-wrap">{draft.instructions}</p>
            {draft.questions.map((q, i) => <fieldset key={q.id} className="my-5 space-y-2"><legend className="mb-2 whitespace-pre-wrap font-medium">{i + 1}. {q.prompt || 'Question text needed'}</legend>{q.options.map((o, j) => <label key={j} className="flex min-h-11 items-center gap-3"><input type="radio" className="h-5 w-5" name={`preview-${q.id}`} checked={answers[q.id] === j} onChange={() => { setAnswers(a => ({ ...a, [q.id]: j })); setShowReport(false); }} /><span className="whitespace-pre-wrap">{o || `Option ${j + 1}`}</span></label>)}</fieldset>)}
            <div className="flex gap-3"><Button disabled={!!issues.length} onClick={() => setShowReport(true)}>Preview diagnostic report</Button><Button variant="ghost" onClick={() => { setAnswers({}); setShowReport(false); }}>Reset preview answers</Button></div>
            {showReport && <div className="mt-6 space-y-6 border-t border-border pt-6"><p className="font-semibold">A snapshot of demonstrated skills, based on these answers.</p>{diagnosticReport(draft, skills, answers).map(r => <section key={r.skill?.id} className="border-l-4 border-primary pl-4"><h3 className="font-semibold">{r.skill?.name}: {r.status}</h3><p>{r.correct}/{r.answered} answered correctly · {r.total - r.answered} unanswered{r.percent !== null ? ` · ${r.percent}% accuracy on answered questions` : ''}</p><p className="text-sm text-muted">{r.levels.map(l => `${l.level}: ${l.correct}/${l.answered} answered correctly`).join(' · ')}</p><p className="mt-2">{r.next}</p></section>)}
              <h3 className="font-semibold">Question evidence</h3>{draft.questions.map((q, i) => <div key={q.id} className="border-b border-border pb-4"><p>{i + 1}. {q.prompt}</p><p>Your answer: {answers[q.id] === undefined ? 'Unanswered' : q.options[answers[q.id]]}</p><p>Correct answer: {q.options[q.correctIndex]}</p><p className="mt-2 whitespace-pre-wrap text-muted">{q.explanation}</p></div>)}
            </div>}
          </div>
        </>}
        </fieldset>
      </>}
    </div>
  </DashboardShell></AuthGuard>;
}
