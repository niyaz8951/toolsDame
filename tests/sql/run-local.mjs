/*
 * tests/sql/run-local.mjs - runs the core SQL and its tests on a throw-away
 * PostgreSQL inside Node, before anything is pasted into Supabase.
 * Serves: "Rules of work": every function has allowed and refused tests.
 * Must not change: uses the very files the owner pastes (db/core/*.sql and
 * tests/sql/*_test.sql), unchanged. Touches no real database.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite
 * Run:         node tests/sql/run-local.mjs      (exit code 0 = all passed)
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORE = join(HERE, '..', '..', 'db', 'core');
const db = new PGlite();
let failed = 0;

await db.exec(await readFile(join(HERE, 'local-shim.sql'), 'utf8'));

for (const name of (await readdir(CORE)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()) {
  const out = await db.exec(await readFile(join(CORE, name), 'utf8'));
  const problems = out[out.length - 1].rows;
  console.log((problems.length ? 'FAIL  ' : 'ok    ') + name + ' runs; security check finds ' + problems.length + ' problem(s)');
  for (const p of problems) { failed += 1; console.log('        ' + p.problem + ': ' + p.object); }
}

// Running a core file a second time must change nothing and say why.
for (const name of (await readdir(CORE)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()) {
  try {
    await db.exec(await readFile(join(CORE, name), 'utf8'));
    failed += 1; console.log('FAIL  ' + name + ' can be run twice');
  } catch (err) {
    await db.exec('rollback');
    console.log('ok    ' + name + ' refuses to run twice (' + err.message + ')');
  }
}

for (const name of (await readdir(HERE)).filter((f) => /_test\.sql$/.test(f)).sort()) {
  for (let round = 1; round <= 2; round += 1) {
    const out = await db.exec(await readFile(join(HERE, name), 'utf8'));
    const rows = out[out.length - 1].rows;
    const bad = rows.filter((r) => !r.pass);
    failed += bad.length;
    console.log((bad.length ? 'FAIL  ' : 'ok    ') + name + ' round ' + round + ': ' + rows[0].got);
    for (const r of bad) { console.log('        ' + r.test + ' | expected ' + r.expected + ' | got ' + r.got); }
    if (process.argv.includes('--all') && round === 1) { for (const r of rows) { console.log('        ' + (r.pass ? 'ok   ' : 'FAIL ') + r.test); } }
  }
  const left = await db.query("select (select count(*) from core.profiles) + (select count(*) from core.audit) + (select count(*) from core.sessions) + (select count(*) from core.spaces) + (select count(*) from core.retired_ids) as n, to_regnamespace('dame_test') is null as clean");
  const tidy = Number(left.rows[0].n) === 0 && left.rows[0].clean;
  if (!tidy) { failed += 1; }
  console.log((tidy ? 'ok    ' : 'FAIL  ') + name + ' leaves nothing behind');
}

console.log(failed ? '\n' + failed + ' problem(s)' : '\nAll SQL checks passed');
process.exit(failed ? 1 : 0);
