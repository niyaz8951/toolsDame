/*
 * tests/phase0.mjs - the phase 0 test: the empty site opens, and the rules
 * that hold for every later phase already hold.
 * Serves: SECURITY "Checklist for every delivery". Must not change: a later
 * phase may add checks here, never remove one. No packages.
 *
 * Run:  node tests/phase0.mjs      (exit code 0 = all passed)
 */
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { start } from '../tools/serve.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8137;
const SITE = 'http://127.0.0.1:' + PORT + '/toolsDame/';
const PAGES = ['', 'index.html', 'hub.html', 'space.html', 'tool.html', 'frame.html',
  'admin/it.html', 'admin/space.html', 'admin/tool.html'];
const ASSETS = ['kit/v1/dame.css', 'kit/v1/dame.js', 'kit/v1/shell.css', 'kit/v1/shell.js',
  'kit/v1/api.js', 'kit/v1/config.js', 'kit/v1/icon.svg', 'kit/ai-prompt.md', 'kit/dame.schema.json',
  'help/index.md', 'help/hub.md', 'help/space.md', 'help/tool.md',
  'help/admin-it.md', 'help/admin-space.md', 'help/admin-tool.md'];

let failed = 0;
function check(ok, what) {
  if (!ok) { failed += 1; }
  console.log((ok ? 'ok    ' : 'FAIL  ') + what);
}

async function files(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') { continue; }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) { await files(full, out); } else { out.push(full); }
  }
  return out;
}

const server = await start(PORT);
try {
  // 1. Every page opens and carries the page rules.
  for (const page of PAGES) {
    const res = await fetch(SITE + page);
    const html = await res.text();
    const name = page || '(site root)';
    check(res.status === 200, name + ' opens');
    const head = html.slice(html.indexOf('<head>') + 6).trimStart();
    check(head.startsWith('<meta http-equiv="Content-Security-Policy"'), name + ' security policy is the first element of the head');
    check(/default-src 'none'/.test(head) && !/unsafe-inline|unsafe-eval|\*/.test(head.split('>')[0]), name + ' policy starts from "nothing allowed", no unsafe or wildcard');
    check(/<meta name="robots" content="noindex/.test(html), name + ' is hidden from search engines');
    check(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), name + ' has no inline script');
    check(!/\son[a-z]+\s*=|\sstyle\s*=|javascript:/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), name + ' has no inline handler or style');
    check(!/(src|href)\s*=\s*["'](https?:)?\/\//i.test(html), name + ' loads nothing from outside');
    check(!/(src|href)\s*=\s*["']\//i.test(html), name + ' uses no fixed base path');
  }

  // 2. Every file the pages need is served; hidden files and other paths are not.
  for (const asset of ASSETS) {
    check((await fetch(SITE + asset)).status === 200, asset + ' is served');
  }
  check((await fetch(SITE + '.git/config')).status === 404, 'hidden files are refused');
  check((await fetch(SITE + '..%2f..%2fetc/passwd')).status === 404, 'paths outside the repo are refused');
  check((await fetch('http://127.0.0.1:' + PORT + '/other/')).status === 404, 'paths outside /toolsDame/ are refused');

  // 3. Nothing private and no account name anywhere in the repo.
  const BAD = [
    [/sb_secret_[A-Za-z0-9_-]{8,}/, 'a Supabase secret key'],
    [/service_role/, 'the words service_role outside docs'],
    [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, 'a signed token'],
    [/postgres(ql)?:\/\/[^\s'"]+:[^\s'"]+@/, 'a database address with a password'],
    [/[a-z0-9-]+\.github\.io/i, 'a GitHub Pages address (it holds the account name)'],
    [/github\.com\/[A-Za-z0-9-]+\/toolsDame/i, 'the repo address (it holds the account name)']
  ];
  const TEXT = /\.(html|css|js|mjs|json|md|sql|svg|txt)$/;
  for (const full of await files(ROOT)) {
    const rel = relative(ROOT, full).split('\\').join('/');
    if (!TEXT.test(rel) || rel === 'tests/phase0.mjs') { continue; }
    const text = await readFile(full, 'utf8');
    for (const [pattern, what] of BAD) {
      if (what.startsWith('the words') && !/\.(js|mjs|html|sql|json)$/.test(rel)) { continue; }
      if (pattern.test(text)) { check(false, rel + ' contains ' + what); }
    }
  }
  check(true, 'repo scanned for keys, passwords and account names');

  // 4. config.js holds nothing, or only the two public values.
  const config = await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8');
  const keys = [...config.matchAll(/^\s*([A-Za-z]+)\s*:/gm)].map((m) => m[1]).sort().join(',');
  check(keys === 'publishableKey,supabaseUrl', 'config.js holds only supabaseUrl and publishableKey');

  // 5. Every source file starts with its note.
  for (const full of await files(ROOT)) {
    const rel = relative(ROOT, full).split('\\').join('/');
    if (!/\.(html|css|js|mjs)$/.test(rel)) { continue; }
    const top = (await readFile(full, 'utf8')).slice(0, 400);
    check(/Must not change/.test(top) || /Must not change/.test((await readFile(full, 'utf8')).slice(0, 900)), rel + ' starts with its note');
  }
} finally {
  server.close();
}

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed');
process.exit(failed ? 1 : 0);
