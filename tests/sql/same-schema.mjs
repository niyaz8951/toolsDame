/*
 * tests/sql/same-schema.mjs - proves that db/install (the final, tidy install
 * for IT) makes exactly the database that db/core/001..012 made (the files that
 * built the demo database, run one after the other).
 * Serves: the hand-over to IT; contracts 1-7 unchanged.
 * Must not change: compares two throw-away databases object by object: every
 * table and column (order, type, default, not null), constraint, index,
 * trigger, policy, function (its whole code, rights, owner settings), row
 * security, the rights on schemas and tables, default rights, the site's
 * settings and the file store bucket. Any difference fails. Touches no real database.
 *
 * Needs once:  npm install --no-save @electric-sql/pglite
 * Run:         node tests/sql/same-schema.mjs      (exit code 0 = the same)
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CORE = join(ROOT, 'db', 'core');
const INSTALL = join(ROOT, 'db', 'install');

// The install's files, in the order db/install/install.sql reads them.
async function installFiles() {
  const runner = await readFile(join(INSTALL, 'install.sql'), 'utf8');
  return [...runner.matchAll(/^\\ir\s+(\S+)/gm)].map((m) => join(INSTALL, m[1]));
}
async function historyFiles() {
  return (await readdir(CORE)).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort().map((f) => join(CORE, f));
}

async function build(files, wrap) {
  const db = new PGlite();
  await db.exec(await readFile(join(HERE, 'local-shim.sql'), 'utf8'));
  if (wrap) await db.exec('begin');
  for (const f of files) await db.exec(await readFile(f, 'utf8'));
  if (wrap) await db.exec('commit');
  return db;
}

const OURS = "('core', 'public', 'storage')";
const QUERIES = {
  columns: `select c.oid::regclass::text || '.' || a.attname || ' #' || a.attnum || ' ' || pg_catalog.format_type(a.atttypid, a.atttypmod)
              || case when a.attnotnull then ' not null' else '' end
              || coalesce(' default ' || pg_catalog.pg_get_expr(d.adbin, d.adrelid), '')
              || case when a.attidentity::text <> '' then ' identity ' || a.attidentity::text else '' end as x
              from pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid
              join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
             where n.nspname in ${OURS} and c.relkind in ('r', 'p', 'v') and a.attnum > 0 and not a.attisdropped`,
  constraints: `select c.conrelid::regclass::text || ' ' || c.conname || ': ' || pg_catalog.pg_get_constraintdef(c.oid) as x
                  from pg_catalog.pg_constraint c join pg_catalog.pg_namespace n on n.oid = c.connamespace where n.nspname in ${OURS}`,
  indexes: `select pg_catalog.pg_get_indexdef(i.indexrelid) as x from pg_catalog.pg_index i
              join pg_catalog.pg_class c on c.oid = i.indrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ${OURS}`,
  triggers: `select pg_catalog.pg_get_triggerdef(t.oid) as x from pg_catalog.pg_trigger t
               join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
              where n.nspname in ${OURS} and not t.tgisinternal`,
  policies: `select p.schemaname || '.' || p.tablename || ' ' || p.policyname || ' ' || p.cmd || ' ' || p.roles::text
               || ' using ' || coalesce(p.qual, '-') || ' check ' || coalesce(p.with_check, '-') as x from pg_catalog.pg_policies p`,
  functions: `select pg_catalog.pg_get_functiondef(p.oid) || ' ACL ' || coalesce(p.proacl::text, '-') as x
                from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
               where n.nspname in ('core', 'public')`,
  relations: `select c.oid::regclass::text || ' kind ' || c.relkind::text || ' rls ' || c.relrowsecurity || ' forced ' || c.relforcerowsecurity
                || ' acl ' || coalesce(c.relacl::text, '-') as x
                from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where n.nspname in ${OURS}`,
  schemas: `select n.nspname || ' ' || coalesce(n.nspacl::text, '-') as x from pg_catalog.pg_namespace n
             where n.nspname in ${OURS} or n.nspname like 't\\_%' or n.nspname like 'p\\_%'`,
  default_rights: `select d.defaclrole::regrole::text || ' ' || coalesce(d.defaclnamespace::regnamespace::text, '-') || ' '
                     || d.defaclobjtype::text || ' ' || d.defaclacl::text as x from pg_catalog.pg_default_acl d`,
  settings: `select s.key || '=' || s.value as x from core.settings s`,
  buckets: `select row(b.*)::text as x from storage.buckets b`,
  security_check: `select problem || ' ' || object as x from core.security_check()`,
};

async function snapshot(db) {
  const out = {};
  for (const [name, sql] of Object.entries(QUERIES)) {
    out[name] = (await db.query(sql)).rows.map((r) => r.x).sort();
  }
  return out;
}

const history = await snapshot(await build(await historyFiles(), false));
const install = await snapshot(await build(await installFiles(), true));
let failed = 0;
for (const name of Object.keys(QUERIES)) {
  const a = new Set(history[name]); const b = new Set(install[name]);
  const onlyA = history[name].filter((x) => !b.has(x));
  const onlyB = install[name].filter((x) => !a.has(x));
  const same = onlyA.length === 0 && onlyB.length === 0 && history[name].length === install[name].length;
  console.log((same ? 'ok    ' : 'FAIL  ') + name.padEnd(15) + history[name].length + ' compared');
  if (!same) {
    failed += 1;
    for (const x of onlyA) console.log('        only in db/core:    ' + x.split('\n')[0].slice(0, 200));
    for (const x of onlyB) console.log('        only in db/install: ' + x.split('\n')[0].slice(0, 200));
  }
}
if (install.security_check.length) { failed += 1; console.log('FAIL  the install leaves security problems'); }
console.log(failed ? '\nThe two databases differ' : '\ndb/install makes the same database as db/core/001..012');
process.exit(failed ? 1 : 0);
