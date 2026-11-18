export const LEVELS = ['beginner', 'intermediate', 'advanced'] as const;
export type Difficulty = typeof LEVELS[number];
export interface Skill { id: string; track_id: string; topic: string; name: string }
export interface DiagnosticQuestion {
  id: string;
  prompt: string;
  options: string[];
  correctIndex: number;
  skillId: string;
  difficulty: Difficulty;
  explanation: string;
}
export interface DiagnosticDraft {
  title: string;
  trackId: string;
  audience: string;
  instructions: string;
  skillIds: string[];
  questions: DiagnosticQuestion[];
  minimumEvidence: number;
  targetPercent: number;
}
export const emptyDiagnostic = (): DiagnosticDraft => ({
  title: '', trackId: '', audience: '', instructions: '', skillIds: [], questions: [],
  minimumEvidence: 3, targetPercent: 75,
});
export function validateDraft(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['Provide a diagnostic draft.'];
  const d = value as DiagnosticDraft;
  const errors: string[] = [];
  for (const key of ['title', 'trackId', 'audience', 'instructions'] as const) {
    if (typeof d[key] !== 'string' || d[key].length > 10000) errors.push(`Invalid ${key}.`);
  }
  if (typeof d.title !== 'string' || !d.title.trim()) errors.push('Give the diagnostic a title.');
  if (typeof d.trackId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(d.trackId)) errors.push('Choose a track.');
  if (!Array.isArray(d.skillIds) || d.skillIds.some(id => typeof id !== 'string') || new Set(d.skillIds).size !== d.skillIds.length) errors.push('Choose distinct skills.');
  if (!Number.isInteger(d.minimumEvidence) || d.minimumEvidence < 3 || d.minimumEvidence > 30) errors.push('Minimum evidence must be between 3 and 30 questions per skill.');
  if (!Number.isInteger(d.targetPercent) || d.targetPercent < 1 || d.targetPercent > 100) errors.push('The target must be between 1 and 100 percent.');
  if (!Array.isArray(d.questions) || d.questions.length > 500) return [...errors, 'A diagnostic supports up to 500 questions.'];
  const ids = new Set<string>();
  d.questions.forEach((q, i) => {
    if (!q || typeof q !== 'object') { errors.push(`Question ${i + 1} is invalid.`); return; }
    if (typeof q.id !== 'string' || !q.id || ids.has(q.id)) errors.push(`Question ${i + 1} needs a unique ID.`);
    ids.add(q.id);
    if (typeof q.prompt !== 'string' || typeof q.explanation !== 'string' || typeof q.skillId !== 'string') errors.push(`Question ${i + 1} has invalid text fields.`);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6 || q.options.some(o => typeof o !== 'string')) errors.push(`Question ${i + 1} needs 2 to 6 answer options.`);
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options?.length) errors.push(`Question ${i + 1} needs a valid correct answer.`);
    if (!LEVELS.includes(q.difficulty)) errors.push(`Question ${i + 1} needs a difficulty.`);
  });
  return errors;
}
export function publicationIssues(d: DiagnosticDraft, skills: Skill[]): string[] {
  const errors = validateDraft(d);
  if (errors.length) return errors;
  if (!d.audience.trim()) errors.push('Describe the intended grade or audience.');
  if (!d.skillIds.length) errors.push('Select at least one skill to measure.');
  const available = new Map(skills.filter(s => s.track_id === d.trackId).map(s => [s.id, s]));
  for (const id of d.skillIds) {
    const skill = available.get(id);
    if (!skill) { errors.push('A selected skill does not belong to this track.'); continue; }
    const questions = d.questions.filter(q => q.skillId === id);
    if (questions.length < d.minimumEvidence) errors.push(`${skill.name}: add at least ${d.minimumEvidence} questions.`);
    for (const level of LEVELS) if (!questions.some(q => q.difficulty === level)) errors.push(`${skill.name}: add a ${level} question.`);
  }
  d.questions.forEach((q, i) => {
    if (!q.prompt.trim() || !q.explanation.trim()) errors.push(`Question ${i + 1}: add the question and its explanation.`);
    if (q.options.some(o => !o.trim()) || new Set(q.options.map(o => o.trim().toLowerCase())).size !== q.options.length) errors.push(`Question ${i + 1}: answer options must be nonempty and distinct.`);
    if (!d.skillIds.includes(q.skillId)) errors.push(`Question ${i + 1}: assign a selected skill.`);
  });
  return errors;
}
// Evidence rules are deliberately deterministic. Preview and future learner reports
// use the same function; an unanswered question is not evidence of a misconception.
export function diagnosticReport(d: DiagnosticDraft, skills: Skill[], answers: Record<string, number>) {
  return d.skillIds.map(id => {
    const questions = d.questions.filter(q => q.skillId === id);
    const answered = questions.filter(q => Number.isInteger(answers[q.id]) && answers[q.id] >= 0 && answers[q.id] < q.options.length);
    const correct = answered.filter(q => answers[q.id] === q.correctIndex);
    const levels = LEVELS.map(level => {
      const seen = answered.filter(q => q.difficulty === level);
      return { level, answered: seen.length, correct: seen.filter(q => answers[q.id] === q.correctIndex).length };
    });
    const inconsistent = answered.some(q => answers[q.id] !== q.correctIndex && correct.some(c => LEVELS.indexOf(c.difficulty) > LEVELS.indexOf(q.difficulty)));
    const percent = answered.length ? Math.round(correct.length / answered.length * 100) : null;
    const status = answered.length < d.minimumEvidence || levels.some(l => l.answered === 0)
      ? 'Insufficient evidence' : inconsistent ? 'Verify this skill' : correct.length / answered.length * 100 >= d.targetPercent ? 'Demonstrated strength' : 'Needs development';
    const next = status === 'Insufficient evidence' ? 'Answer more questions across the difficulty levels before drawing a conclusion.'
      : status === 'Verify this skill' ? 'Use fresh questions to check the mixed results before choosing a learning route.'
      : status === 'Demonstrated strength' ? 'Consider a fresh checkpoint to confirm readiness for the next stage.'
      : 'Assign learning and practice for this skill, then reassess with fresh questions.';
    return { skill: skills.find(s => s.id === id), status, percent, answered: answered.length, total: questions.length, correct: correct.length, levels, next };
  });
}
