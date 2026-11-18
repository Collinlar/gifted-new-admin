const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const XLSX = require('xlsx');
const { PGlite } = require('../.tmp-paper-tests/node_modules/@electric-sql/pglite/dist/index.cjs');

// Exercise the actual import handler with PostgreSQL persistence, using the
// registration schema and guest-column migration from this repository.
const route = fs.readFileSync('app/api/[...slug]/route.ts', 'utf8');
const start = route.indexOf('  if (p0 === "import-registrations") {');
const end = route.indexOf('  // POST /preview-certificate', start);
const handler = ts.transpileModule(`async function run(body) {
  const p0 = 'import-registrations';
  ${route.slice(start, end)}
}`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;

test('bulk upload accepts omitted and blank emails and preserves account matching', async () => {
  const db = new PGlite();
  try {
    await db.exec(fs.readFileSync('supabase/registrations.sql', 'utf8').split('-- ── Answer memory')[0]);
    const guestMigration = fs.readFileSync('supabase/registrations_v4.sql', 'utf8');
    await db.exec(guestMigration.slice(guestMigration.indexOf('ALTER TABLE registrations'), guestMigration.indexOf('-- ── Reading identity')));
    await db.exec('CREATE TABLE users(id uuid PRIMARY KEY, email text);');
    const formId = (await db.query(`INSERT INTO registration_forms(title,fields) VALUES
      ('Bulk upload test', '[{"key":"given","source":"profile.first_name"},{"key":"surname","source":"profile.last_name"}]') RETURNING id`)).rows[0].id;
    const userId = '11111111-1111-4111-8111-111111111111';
    await db.query('INSERT INTO users VALUES ($1,$2)', [userId, 'existing@example.test']);
    const supabase = { from(table) {
      return {
        select() { return this; },
        eq(key, value) { this.key = key; this.value = value; return this; },
        async single() {
          const result = await db.query(`SELECT fields FROM registration_forms WHERE id=$1`, [this.value]);
          return { data: result.rows[0], error: null };
        },
        async in(key, values) {
          const result = await db.query('SELECT id,email FROM users WHERE email = ANY($1)', [values]);
          return { data: result.rows, error: null };
        },
        upsert(rows, options) {
          assert.equal(table, 'registrations');
          assert.equal(options.onConflict, 'form_id,user_id');
          assert.equal(options.ignoreDuplicates, true);
          return { async select() {
            const columns = Object.keys(rows[0]);
            const values = rows.flatMap(row => columns.map(column => row[column]));
            const placeholders = rows.map((row, i) => `(${columns.map((_, j) => '$' + (i * columns.length + j + 1)).join(',')})`);
            const result = await db.query(`INSERT INTO registrations (${columns.join(',')}) VALUES ${placeholders.join(',')}
              ON CONFLICT (form_id,user_id) DO NOTHING RETURNING id`, values);
            return { data: result.rows, error: null };
          } };
        },
      };
    } };
    const context = { supabase, ok: value => value, err: error => ({ error }) };
    vm.createContext(context);
    vm.runInContext(handler, context);
    const upload = rows => context.run({ formId, rows, source: 'bulk-test.csv' });
    const csv = 'given,surname,phone\nTest,Ama,0200000001\nTest,Kojo,0200000002\nTest,Akua,0200000003';
    const workbook = XLSX.read(csv, { type: 'string', raw: true });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    let result = await upload(rows);
    assert.equal(result.imported, 3);
    assert.equal(result.skipped, 0);
    assert.equal(result.unmatched.length, 0);
    const stored = (await db.query('SELECT * FROM registrations ORDER BY guest_name')).rows;
    assert.equal(stored.length, 3);
    assert.ok(stored.every(row => row.user_id === null && row.guest_email === null && row.status === 'submitted'));
    assert.equal(stored[0].guest_name, 'Test Akua');
    assert.equal(stored[0].guest_phone, '0200000003');
    assert.equal(stored[0].answers.surname, 'Akua');
    result = await upload([
      { __email: '', given: 'Blank email' },
      { __email: '   ', given: 'Whitespace email' },
      { __email: ' EXISTING@example.test ', given: 'Account' },
      { __email: 'missing@example.test', given: 'Unmatched' },
    ]);
    assert.equal(result.imported, 3);
    assert.equal(result.unmatched[0], 'missing@example.test');
    result = await upload([{ __email: 'existing@example.test', given: 'Duplicate' }]);
    assert.equal(result.imported, 0);
    assert.equal(result.skipped, 1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM registrations')).rows[0].n, 6);
    assert.ok((await upload([null])).error);
    assert.ok((await upload([])).error);
    console.log('PASS: CSV with no email column persisted 3 guests; mixed batch persisted 2 guests and 1 account; duplicate account skipped.');
  } finally { await db.close(); }
});
