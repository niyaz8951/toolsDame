/*
 * tests/sql/run-local.mjs - builds the database from db/ on a throw-away
 * PostgreSQL inside Node and runs every SQL test on it, before anything is
 * pasted into a real database.
 * Serves: "Rules of work": every function has allowed and refused tests.
 * Must not change: uses the very files that are installed (db/install.sql and
 * the files it names, in its order, in one transaction) and tests/sql/*_test.sql,
 * unchanged. Touches no real database.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite
 * Run:         node tests/sql/run-local.mjs      (exit code 0 = all passed)
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const HERE = dirname(fileURLToPath(import.meta.url));
const DB = join(HERE, '..', '..', 'db');
const db = new PGlite();
let failed = 0;

await db.exec(await readFile(join(HERE, 'local-shim.sql'), 'utf8'));

// The files in the order install.sql reads them, in one transaction, as psql runs it.
const runner = await readFile(join(DB, 'install.sql'), 'utf8');
const parts = [...runner.matchAll(/^\\ir\s+(\S+)/gm)].map((m) => m[1]);
const all = 'begin;\n' + (await Promise.all(parts.map((f) => readFile(join(DB, f), 'utf8')))).join('\n') + '\ncommit;';
await db.exec(all);
const problems = (await db.query('select * from core.security_check()')).rows;
console.log((problems.length ? 'FAIL  ' : 'ok    ') + 'db/install.sql (' + parts.length + ' files) runs; security check finds ' + problems.length + ' problem(s)');
for (const p of problems) { failed += 1; console.log('        ' + p.problem + ': ' + p.object); }

// Running it a second time must change nothing and say why.
try {
  await db.exec(all);
  failed += 1; console.log('FAIL  db/install.sql can be run twice');
} catch (err) {
  await db.exec('rollback');
  console.log('ok    db/install.sql refuses to run twice (' + err.message + ')');
}

// db/check.sql says "yes" on the database just built.
const check = (await db.query(await readFile(join(DB, 'check.sql'), 'utf8'))).rows[0];
if (check.final_version !== 'yes') {
  failed += 1;
  console.log('FAIL  db/check.sql says no: put ' + check.fingerprint + ' in it as the expected value, if the change was meant');
} else {
  console.log('ok    db/check.sql says this is the final version (' + check.parts + ' parts)');
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
  const left = await db.query("select (select count(*) from core.profiles) + (select count(*) from core.audit) + (select count(*) from core.sessions) + (select count(*) from core.spaces) + (select count(*) from core.retired_ids) + (select count(*) from core.tool_versions) + (select count(*) from core.tool_tables) + (select count(*) from pg_namespace where nspname like 't\\_%' or nspname like 'p\\_%') + (select count(*) from storage.objects) as n, to_regnamespace('dame_test') is null as clean");
  const tidy = Number(left.rows[0].n) === 0 && left.rows[0].clean;
  if (!tidy) { failed += 1; }
  console.log((tidy ? 'ok    ' : 'FAIL  ') + name + ' leaves nothing behind');
}

// db/upgrade-relay.sql on the database as it was before Relay (every file but 09_relay.sql)
// must give the same database as a fresh install: check.sql says yes, and every Relay function
// has the same code, word for word.
{
  const old = new PGlite();
  await old.exec(await readFile(join(HERE, 'local-shim.sql'), 'utf8'));
  const before = parts.filter((f) => f !== '09_relay.sql');
  await old.exec('begin;\n' + (await Promise.all(before.map((f) => readFile(join(DB, f), 'utf8')))).join('\n') + '\ncommit;');
  await old.exec(await readFile(join(DB, 'upgrade-relay.sql'), 'utf8'));
  const said = (await old.query(await readFile(join(DB, 'check.sql'), 'utf8'))).rows[0].final_version;
  const code = "select md5(string_agg(p.proname || pg_get_function_identity_arguments(p.oid) || p.prosrc || array_to_string(p.proconfig, ',') || p.prosecdef, '|' order by p.proname)) as m from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname like '%relay%'";
  const same = (await old.query(code)).rows[0].m === (await db.query(code)).rows[0].m;
  const rights = "select string_agg(p.proname || ':' || has_function_privilege('authenticated', p.oid, 'execute') || has_function_privilege('anon', p.oid, 'execute'), ',' order by p.proname) as r from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'dame\\_%'";
  const sameRights = (await old.query(rights)).rows[0].r === (await db.query(rights)).rows[0].r;
  const clean = (await old.query('select count(*)::int as n from core.security_check()')).rows[0].n === 0;
  let twice = false;
  try { await old.exec(await readFile(join(DB, 'upgrade-relay.sql'), 'utf8')); } catch (err) { twice = /already/.test(err.message); await old.exec('rollback').catch(() => {}); }
  const ok = said === 'yes' && same && sameRights && clean && twice;
  if (!ok) { failed += 1; }
  console.log((ok ? 'ok    ' : 'FAIL  ') + 'db/upgrade-relay.sql on the version before: check.sql ' + said + ', Relay code ' + (same ? 'identical' : 'DIFFERENT') +
    ', rights ' + (sameRights ? 'identical' : 'DIFFERENT') + ', security check ' + (clean ? 'empty' : 'NOT EMPTY') + ', a second run ' + (twice ? 'refused' : 'NOT REFUSED'));
}

console.log(failed ? '\n' + failed + ' problem(s)' : '\nAll SQL checks passed');
process.exit(failed ? 1 : 0);
