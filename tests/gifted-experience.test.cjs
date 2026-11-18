const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/giftedExperience.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exports_ });
const { validateGiftedExperience, publicationIssues, stepApplies } = exports_;
const id = '00000000-0000-4000-8000-000000000001';
const diagnostic = '00000000-0000-4000-8000-000000000002';
const good = { title: 'Math readiness route', trackId: id, description: 'A guided route.', steps: [
  { id: 'diagnostic', type: 'diagnostic', title: 'Find your starting point', description: '', href: '/diagnostics', diagnosticId: diagnostic, diagnosticVersion: 1 },
  { id: 'learn', type: 'resource', title: 'Learn fractions', description: '', href: '/learning-management' },
] };
test('accepts a diagnostic-first internal journey', () => assert.equal(validateGiftedExperience(good).length, 0));
test('requires a diagnostic first when publishing', () => assert.match(publicationIssues({ ...good, steps: good.steps.slice(1) }).join(' '), /first stage/i));
test('rejects external and protocol-relative destinations', () => {
  for (const href of ['https://example.com', '//example.com']) assert.match(validateGiftedExperience({ ...good, steps: [{ ...good.steps[1], href }] }).join(' '), /safe internal/i);
});
test('rejects duplicate stage ids and unpublished diagnostics', () => {
  const draft = { ...good, steps: [{ ...good.steps[0], diagnosticVersion: 0 }, { ...good.steps[1], id: 'diagnostic' }] };
  const issues = validateGiftedExperience(draft).join(' ');
  assert.match(issues, /published diagnostic/i); assert.match(issues, /unique ID/i);
});
test('routes stages from diagnostic outcomes without changing unconditional stages', () => {
  const findings = [{ skill: { id }, status: 'Needs development' }, { skill: { id: diagnostic }, status: 'Demonstrated strength' }];
  assert.equal(stepApplies(good.steps[1], findings), true);
  assert.equal(stepApplies({ ...good.steps[1], condition: { outcome: 'needs_development', skillId: id } }, findings), true);
  assert.equal(stepApplies({ ...good.steps[1], condition: { outcome: 'verify_skill', skillId: id } }, findings), false);
  assert.equal(stepApplies({ ...good.steps[1], condition: { outcome: 'all_demonstrated_strength' } }, findings), false);
  assert.equal(stepApplies({ ...good.steps[1], condition: { outcome: 'demonstrated_strength', skillId: diagnostic } }, findings), true);
});
