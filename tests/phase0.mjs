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
const PAGES = ['', 'index.html', 'hub.html', 'space.html', 'tool.html', 'frame.html', 'pack.html', 'blocks.html', 'book.html', 'account.html',
  'admin/it.html', 'admin/space.html', 'admin/tool.html'];
const ASSETS = ['kit/v1/dame.css', 'kit/v1/dame.js', 'kit/v1/shell.css', 'kit/v1/shell.js',
  'kit/v1/api.js', 'kit/v1/config.js', 'pages/index.js', 'pages/hub.js', 'pages/admin-it.js', 'pages/space.js', 'pages/admin-space.js', 'pages/admin-tool.js', 'pages/tool.js', 'pages/blocks.js', 'kit/v1/pack.js', 'kit/v1/lib/index.json', 'kit/v1/lib/exceljs.js', 'kit/starter/index.html', 'kit/starter/tracker.html', 'examples/converter/index.html',
  'examples/parts-extractor/index.html',
  'examples/hello-tool/index.html', 'examples/hello-tool/about.html', 'examples/hello-tool/style.css', 'examples/hello-tool/app.js', 'kit/v1/icon.svg', 'kit/ai-prompt.md', 'kit/dame.schema.json',
  'help/index.md', 'help/hub.md', 'help/space.md', 'help/tool.md',
  'help/admin-it.md', 'help/admin-space.md', 'help/admin-tool.md', 'help/book.md', 'help/account.md', 'pages/account.js', 'pages/book.js', 'kit/v1/theme.js',
  'book/index.json', 'book/01-what.md', 'book/02-structure.md', 'book/03-people.md', 'book/04-building.md', 'book/05-data.md',
  'book/06-security.md', 'book/07-it.md', 'book/08-every-page.md', 'book/09-status.md', 'book/10-notes.md',
  'book/11-architecture.md', 'book/12-identity.md', 'book/13-access.md', 'book/14-database.md', 'book/15-frame.md', 'book/16-releases.md',
  'book/17-data.md', 'book/18-builder.md', 'book/19-audit.md', 'book/20-tests.md', 'book/21-decisions.md', 'book/22-questions.md', 'book/23-gaps.md'];

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

const CONFIG_URL = ((await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8')).match(/supabaseUrl:\s*'([^']*)'/) || [])[1];
const TOOL_JS = await readFile(join(ROOT, 'pages/tool.js'), 'utf8');
const SEALED = new Function('return ' + TOOL_JS.slice(TOOL_JS.indexOf('var POLICY = ') + 13, TOOL_JS.indexOf(";\n  var SANDBOX")))();
check(/var SANDBOX = 'allow-scripts allow-forms allow-modals';/.test(TOOL_JS), 'the sealed frame has no same-origin, pop-up, top-navigation or download right');
const SHELF_FILE = /^kit\/v1\/lib\/[^/]+\.js$/;   // library files from their publishers, kept byte for byte
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
    const policy = (head.match(/content="([^"]*)"/) || [])[1] || '';
    if (page === 'frame.html') {
      // The one page that allows inline code: the sealed frame inherits exactly this, and nothing reaches the network.
      check(policy === SEALED, name + ' carries exactly the sealed-frame policy written in pages/tool.js');
      check(/default-src 'none'/.test(policy) && /connect-src 'none'/.test(policy) && /frame-src 'none'/.test(policy) && /form-action 'none'/.test(policy) && !/https?:|\*|'self'|unsafe-eval/.test(policy), name + ' policy names no address at all');
      check(!/<script/i.test(html), name + ' runs no script of its own');
    } else {
      const inline = policy.split(';').filter((d) => /unsafe-inline/.test(d)).map((d) => d.trim());
      check(/default-src 'none'/.test(policy) && !/unsafe-eval|\*/.test(policy) && (inline.length === 0 || (page === 'pack.html' && inline.join() === "style-src 'unsafe-inline'")), name + ' policy starts from "nothing allowed", no unsafe or wildcard');
    }
    check(/<meta name="robots" content="noindex/.test(html), name + ' is hidden from search engines');
    check(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), name + ' has no inline script');
    check(!/\son[a-z]+\s*=|\sstyle\s*=|javascript:/i.test(html.replace(/<!--[\s\S]*?-->/g, '')), name + ' has no inline handler or style');
    // One outside address may be named, and only as a hint to open the connection early: the database of config.js.
    const hint = (html.match(/<link rel="preconnect" href="([^"]*)" crossorigin>/) || [])[1];
    check(!hint || hint === CONFIG_URL, name + ' names no outside address but the database of config.js');
    check(!/(src|href)\s*=\s*["'](https?:)?\/\//i.test(html.replace(/<link rel="preconnect" href="[^"]*" crossorigin>/, '')), name + ' loads nothing from outside');
    check(!/(src|href)\s*=\s*["']\//i.test(html), name + ' uses no fixed base path');
    const hosts = [...head.split('>')[0].matchAll(/https?:\/\/[^\s;'"]+/g)].map((m) => m[0]);
    check(hosts.every((h) => h === CONFIG_URL), name + ' may call only this site and the database in config.js');
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
    if (!TEXT.test(rel) || rel === 'tests/phase0.mjs' || SHELF_FILE.test(rel)) { continue; }
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
    if (!/\.(html|css|js|mjs)$/.test(rel) || SHELF_FILE.test(rel)) { continue; }
    const top = (await readFile(full, 'utf8')).slice(0, 400);
    check(/Must not change/.test(top) || /Must not change/.test((await readFile(full, 'utf8')).slice(0, 900)), rel + ' starts with its note');
  }
} finally {
  server.close();
}

// 6. One look: every building block of dame.css is shown on blocks.html and given to the AI.
{
  const css = await readFile(join(ROOT, 'kit/v1/dame.css'), 'utf8');
  const prompt = await readFile(join(ROOT, 'kit/ai-prompt.md'), 'utf8');
  const blocks = await readFile(join(ROOT, 'blocks.html'), 'utf8');
  const classes = [...new Set([...css.matchAll(/\.(dame-[a-z-]+)/g)].map((m) => m[1]))].filter((c) => c !== 'dame-toast' && c !== 'dame-tool');
  const notInPrompt = classes.filter((c) => !new RegExp(c + '(?![a-z-])').test(prompt));
  const notShown = classes.filter((c) => !new RegExp(c + '(?![a-z-])').test(blocks));
  check(classes.length >= 30, 'dame.css has ' + classes.length + ' building-block classes');
  check(notInPrompt.length === 0, 'every building block is in the starter kit for the AI' + (notInPrompt.length ? ' -> missing: ' + notInPrompt.join(', ') : ''));
  check(notShown.length === 0, 'every building block is shown on blocks.html' + (notShown.length ? ' -> missing: ' + notShown.join(', ') : ''));
  const used = [...new Set([...(prompt + blocks).matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => /^dame-/.test(c)))];
  const unknown = used.filter((c) => !classes.includes(c));
  check(unknown.length === 0, 'the starter kit and blocks.html name no block that does not exist' + (unknown.length ? ' -> ' + unknown.join(', ') : ''));
  const kitJs = await readFile(join(ROOT, 'kit/v1/dame.js'), 'utf8');
  check(!/<\/script/i.test(kitJs) && !/https?:\/\//.test(kitJs), 'the kit script holds no closing script tag and no address');
  for (const name of ['ready', 'toast', 'drop', 'download', 'progress', 'pause', 'people']) {
    check(new RegExp('Dame\\.' + name + '\\(').test(prompt) && new RegExp('\\b' + name + ': ').test(kitJs), 'Dame.' + name + ' exists in the kit and is explained to the AI');
  }
  for (const gap of ['{{TOOL}}', '{{BRIEF}}', '{{HEAD}}', '{{DATARULE}}', '{{DATA}}', '{{LIBS}}', '{{STARTER}}']) {
    check(prompt.includes(gap), 'the starter kit template has the gap ' + gap);
  }
}

// 7. The shelf: each library is the file its publisher made, and fits the sealed frame.
{
  const { createHash } = await import('node:crypto');
  const shelf = JSON.parse(await readFile(join(ROOT, 'kit/v1/lib/index.json'), 'utf8')).libraries;
  check(shelf.length >= 1, 'the shelf lists ' + shelf.length + ' library');
  for (const lib of shelf) {
    const bytes = await readFile(join(ROOT, 'kit/v1/lib', lib.file));
    const text = bytes.toString('utf8');
    check(createHash('sha256').update(bytes).digest('hex') === lib.sha256, lib.name + ' is byte for byte the recorded file');
    check(!/<\/script/i.test(text) && !/\beval\(/.test(text), lib.name + ' holds no closing script tag and no eval');
    check(lib.line === '<script src="/_dame/v1/lib/' + lib.id + '.js"></script>' && /^[a-z0-9-]{2,30}$/.test(lib.id) && lib.how.length > 0 && !!lib.licence, lib.name + ' has its line, licence and how-to');
  }
}

console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nAll checks passed');
process.exit(failed ? 1 : 0);
