const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const vm = require('node:vm');
const source = ts.transpileModule(fs.readFileSync('lib/paperResults.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exports_ = {};
vm.runInNewContext(source, { exports: exports_, Set });
const { validatePaperRows, guessPaperColumns, mapPaperRow } = exports_;
const row = { reference: '001', fullName: 'Ama Mensah', school: '', grade: '', score: '36.5', maximum: '60' };
test('accepts fractional marks, zero scores, and optional school/grade', () => {
  assert.equal(validatePaperRows([row]), null);
  assert.equal(validatePaperRows([{ ...row, score: '0' }]), null);
});
test('rejects missing, negative, nonnumeric, out of range, and overprecision marks', () => {
  for (const score of ['', '-1', 'NaN', 'Infinity', '61', '3.123', '50%', '1e1'])
    assert.ok(validatePaperRows([{ ...row, score }]));
  for (const maximum of ['0', '-1', '', '1000001'])
    assert.ok(validatePaperRows([{ ...row, maximum }]));
});
test('references are required and duplicates are case-insensitive', () => {
  assert.ok(validatePaperRows([{ ...row, reference: '' }]));
  assert.ok(validatePaperRows([{ ...row, reference: ' abc ' }, { ...row, reference: 'ABC' }]));
  assert.equal(validatePaperRows([row, { ...row, reference: '002' }]), null);
});
test('rejects empty/oversized batches and malformed API rows', () => {
  for (const value of [[], null, {}, [null], [{ ...row, score: 36 }], Array(2001).fill(row)])
    assert.ok(validatePaperRows(value));
});
test('recognizes exported and template column names', () => {
  const mapping = guessPaperColumns(['Candidate reference', 'Full name', 'School', 'Grade / class', 'Marks earned', 'Maximum marks']);
  assert.equal(mapping.reference, 'Candidate reference');
  assert.equal(mapping.maximum, 'Maximum marks');
  assert.equal(mapping.grade, 'Grade / class');
  assert.equal(guessPaperColumns(['access_code', 'name', 'score', 'out_of']).maximum, 'out_of');
});
test('retains stored fractional marks and displayed leading-zero references', () => {
  const mapped = mapPaperRow({ reference: '000123', name: 'Ama', score: '37', total: '60' },
    { reference: 123, score: 36.5, total: 60 }, guessPaperColumns(['reference', 'name', 'score', 'total']));
  assert.equal(mapped.reference, '000123');
  assert.equal(mapped.score, '36.5');
  assert.equal(validatePaperRows([mapped]), null);
});
