const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/diagnostics.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exports_, Set, Map });
const { validateDraft, publicationIssues, diagnosticReport, emptyDiagnostic } = exports_;
const trackId = '11111111-1111-4111-8111-111111111111';
const skills = [{ id: 'fractions', track_id: trackId, topic: 'Fractions', name: 'Compare fractions' }];
const draft = {
  ...emptyDiagnostic(), title: 'Entry diagnostic', trackId, audience: 'Basic 7', skillIds: ['fractions'],
  questions: ['beginner', 'intermediate', 'advanced'].map((difficulty, i) => ({
    id: `q${i}`, prompt: `Question ${i}`, options: ['Yes', 'No'], correctIndex: 0,
    skillId: 'fractions', difficulty, explanation: 'Explanation',
  })),
};
test('complete coverage publishes while incomplete draft can still be saved', () => {
  assert.equal(publicationIssues(draft, skills).length, 0);
  const partial = { ...draft, questions: [draft.questions[0]] };
  assert.equal(validateDraft(partial).length, 0);
  assert.ok(publicationIssues(partial, skills).length > 0);
});
test('rejects foreign skills, duplicate options, blank explanation and duplicate IDs', () => {
  assert.ok(publicationIssues(draft, [{ ...skills[0], track_id: 'other' }]).length);
  for (const patch of [{ options: ['yes', ' YES '] }, { explanation: '' }, { skillId: 'other' }, { id: 'q1' }]) {
    assert.ok(publicationIssues({ ...draft, questions: [{ ...draft.questions[0], ...patch }, ...draft.questions.slice(1)] }, skills).length);
  }
});
test('malformed request payloads return errors rather than crashing validation', () => {
  for (const input of [null, {}, { ...draft, title: 42 }, { ...draft, questions: [null] }, { ...draft, questions: [{ options: null }] }, { ...draft, skillIds: {} }]) {
    assert.ok(validateDraft(input).length);
  }
});
test('unanswered questions and invalid option indexes are insufficient evidence', () => {
  for (const answers of [{}, { q0: 0 }, { q0: 0, q1: 0, q2: 99 }]) {
    assert.equal(diagnosticReport(draft, skills, answers)[0].status, 'Insufficient evidence');
  }
});
test('advanced correct with beginner wrong prompts verification, not a capability claim', () => {
  assert.equal(diagnosticReport(draft, skills, { q0: 1, q1: 0, q2: 0 })[0].status, 'Verify this skill');
});
test('consistent results distinguish demonstrated strength from development needs', () => {
  assert.equal(diagnosticReport(draft, skills, { q0: 0, q1: 0, q2: 0 })[0].status, 'Demonstrated strength');
  assert.equal(diagnosticReport(draft, skills, { q0: 0, q1: 1, q2: 1 })[0].status, 'Needs development');
});
test('correct answers on another skill do not create a contradictory pattern', () => {
  const otherSkill = { ...skills[0], id: 'geometry', name: 'Angles' };
  const mixed = { ...draft, skillIds: ['fractions', 'geometry'], questions: [...draft.questions, ...draft.questions.map(q => ({ ...q, id: `g${q.id}`, skillId: 'geometry' }))] };
  const report = diagnosticReport(mixed, [...skills, otherSkill], { q0: 1, q1: 1, q2: 1, gq0: 0, gq1: 0, gq2: 0 });
  assert.equal(report[0].status, 'Needs development');
  assert.equal(report[1].status, 'Demonstrated strength');
});
test('rounding a displayed score does not promote performance below the target', () => {
  const many = { ...draft, targetPercent: 67, questions: Array.from({ length: 6 }, (_, i) => ({ ...draft.questions[Math.floor(i / 2)], id: `m${i}` })) };
  const result = diagnosticReport(many, skills, { m0: 0, m1: 0, m2: 0, m3: 0, m4: 1, m5: 1 })[0];
  assert.equal(result.percent, 67);
  assert.equal(result.status, 'Needs development');
});
