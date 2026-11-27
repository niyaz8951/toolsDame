/*
 * tools/stamp.mjs - prepares the platform's pages for a delivery, in two ways:
 * 1. puts the delivery's stamp on every style and script line
 *    (kit/v1/dame.css -> kit/v1/dame.css?v=STAMP), so that a browser fetches
 *    the new files after a delivery instead of showing old ones;
 * 2. writes the database address of kit/v1/config.js into each page's
 *    security policy (connect-src) and its early-connection hint, so that
 *    config.js is the one place the address is changed (for example when IT
 *    moves the site to its own servers).
 * Serves: "the site must load and work fast", reliability (nobody presses
 * Ctrl+F5 after an update) and the move to IT.
 * Must not change: only local .css and .js lines, the connect-src address and
 * the preconnect line in the pages' own HTML are touched; a page without
 * connect-src 'self' (frame.html, pack.html, blocks.html) gets no address;
 * nothing in tools people upload; the stamp is letters and digits only.
 *
 * Run before each delivery:  node tools/stamp.mjs            (stamp = today's date and time)
 *                            node tools/stamp.mjs 20261127a  (a stamp of your own)
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = process.argv[2] || new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
if (!/^[a-z0-9]{4,20}$/.test(stamp)) { console.error('The stamp must be 4 to 20 lower-case letters and digits.'); process.exit(1); }

// The database address, from config.js only: an origin such as https://abc.supabase.co, or empty.
const config = await readFile(join(ROOT, 'kit/v1/config.js'), 'utf8');
const url = (config.match(/supabaseUrl:\s*'([^']*)'/) || [])[1] || '';
let origin = '';
if (url) {
  try { origin = new URL(url).origin; } catch (e) { origin = ''; }
  if (!/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) { console.error('supabaseUrl in config.js is not an https address: ' + url); process.exit(1); }
}

let files = 0;
let lines = 0;
let addresses = 0;
for (const dir of ['', 'admin']) {
  for (const name of (await readdir(join(ROOT, dir))).filter((f) => f.endsWith('.html'))) {
    const path = join(ROOT, dir, name);
    const html = await readFile(path, 'utf8');
    let out = html.replace(/\b(href|src)="((?!https?:|\/\/|data:)[^"?#]+\.(?:css|js))(?:\?v=[a-z0-9]+)?"/g, (m, attr, file) => { lines += 1; return attr + '="' + file + '?v=' + stamp + '"'; });
    // The address in the policy and in the hint: whatever was there becomes the one in config.js.
    if (/connect-src 'self'/.test(out)) {
      out = out.replace(/connect-src 'self'(?: https:\/\/[^\s;"]+)?/, () => { addresses += 1; return "connect-src 'self'" + (origin ? ' ' + origin : ''); });
      out = out.replace(/<link rel="preconnect" href="[^"]*" crossorigin>\n?/, '');
      if (origin) { out = out.replace(/(<meta charset="utf-8">\n)/, '$1<link rel="preconnect" href="' + origin + '" crossorigin>\n'); }
    }
    if (out !== html) { await writeFile(path, out); files += 1; }
  }
}
console.log('Stamp ' + stamp + ' on ' + lines + ' lines in ' + files + ' pages; database address ' + (origin || '(none)') + ' in ' + addresses + ' pages.');
