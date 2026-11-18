export const EXPERIENCE_STEP_TYPES = ['diagnostic', 'resource', 'practice', 'assessment', 'mock', 'competition', 'camp'] as const;
export type ExperienceStepType = typeof EXPERIENCE_STEP_TYPES[number];
export const EXPERIENCE_OUTCOMES = ['always', 'needs_development', 'verify_skill', 'demonstrated_strength', 'insufficient_evidence', 'all_demonstrated_strength'] as const;
export type ExperienceOutcome = typeof EXPERIENCE_OUTCOMES[number];
export type DiagnosticFinding = { skill?: { id?: string }; status?: string };

export interface ExperienceStep {
  id: string;
  type: ExperienceStepType;
  title: string;
  description: string;
  href: string;
  diagnosticId?: string;
  diagnosticVersion?: number;
  mappingId?: string;
  condition?: { outcome: ExperienceOutcome; skillId?: string };
}

export interface GiftedExperienceDraft {
  title: string;
  trackId: string;
  description: string;
  steps: ExperienceStep[];
}

export const emptyGiftedExperience = (): GiftedExperienceDraft => ({
  title: '', trackId: '', description: '', steps: [],
});

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateGiftedExperience(value: unknown): string[] {
  if (!value || typeof value !== 'object') return ['Provide a Gifted Experience draft.'];
  const draft = value as GiftedExperienceDraft;
  const issues: string[] = [];
  if (typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > 200) issues.push('Give the experience a title up to 200 characters.');
  if (typeof draft.trackId !== 'string' || !uuid.test(draft.trackId)) issues.push('Choose a track.');
  if (typeof draft.description !== 'string' || draft.description.length > 5000) issues.push('Keep the description under 5,000 characters.');
  if (!Array.isArray(draft.steps) || draft.steps.length > 100) return [...issues, 'An experience supports up to 100 stages.'];
  const ids = new Set<string>();
  draft.steps.forEach((step, index) => {
    if (!step || typeof step !== 'object') { issues.push(`Stage ${index + 1} is invalid.`); return; }
    if (typeof step.id !== 'string' || !step.id || ids.has(step.id)) issues.push(`Stage ${index + 1} needs a unique ID.`);
    ids.add(step.id);
    if (!EXPERIENCE_STEP_TYPES.includes(step.type)) issues.push(`Stage ${index + 1} needs a valid type.`);
    if (typeof step.title !== 'string' || !step.title.trim() || step.title.length > 200) issues.push(`Stage ${index + 1} needs a title up to 200 characters.`);
    if (typeof step.description !== 'string' || step.description.length > 2000) issues.push(`Stage ${index + 1} has an invalid description.`);
    if (typeof step.href !== 'string' || !step.href.startsWith('/') || step.href.startsWith('//') || step.href.length > 1000) issues.push(`Stage ${index + 1} needs a safe internal destination.`);
    if (step.type === 'diagnostic' && (!step.diagnosticId || !uuid.test(step.diagnosticId) || !Number.isInteger(step.diagnosticVersion) || Number(step.diagnosticVersion) < 1)) issues.push(`Stage ${index + 1} needs a published diagnostic.`);
    const outcome = step.condition?.outcome || 'always';
    if (!EXPERIENCE_OUTCOMES.includes(outcome)) issues.push(`Stage ${index + 1} needs a valid result condition.`);
    if (step.type === 'diagnostic' && outcome !== 'always') issues.push(`Stage ${index + 1}: diagnostics cannot depend on their own result.`);
    if (step.condition?.skillId && !uuid.test(step.condition.skillId)) issues.push(`Stage ${index + 1} has an invalid condition skill.`);
    if (step.mappingId && !uuid.test(step.mappingId)) issues.push(`Stage ${index + 1} has an invalid content mapping.`);
  });
  return issues;
}

export function stepApplies(step: ExperienceStep, findings: DiagnosticFinding[]): boolean {
  const condition = step.condition;
  const outcome = condition?.outcome || 'always';
  if (outcome === 'always' || step.type === 'diagnostic') return true;
  const relevant = condition?.skillId ? findings.filter(finding => finding.skill?.id === condition.skillId) : findings;
  if (!relevant.length) return false;
  if (outcome === 'all_demonstrated_strength') return relevant.every(finding => finding.status === 'Demonstrated strength');
  const status = outcome === 'needs_development' ? 'Needs development'
    : outcome === 'verify_skill' ? 'Verify this skill'
    : outcome === 'demonstrated_strength' ? 'Demonstrated strength'
    : 'Insufficient evidence';
  return relevant.some(finding => finding.status === status);
}

export function publicationIssues(draft: GiftedExperienceDraft): string[] {
  const issues = validateGiftedExperience(draft);
  if (!draft.steps?.length) issues.push('Add at least one stage.');
  if (draft.steps?.[0]?.type !== 'diagnostic') issues.push('The first stage must be a diagnostic.');
  return issues;
}
