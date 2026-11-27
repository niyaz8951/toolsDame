/*
 * tools/stamp.mjs - puts the delivery's stamp on every style and script line of
 * the platform's pages (kit/v1/dame.css -> kit/v1/dame.css?v=STAMP), so that a
 * browser fetches the new files after a delivery instead of showing old ones.
 * Serves: "the site must load and work fast" and reliability: nobody has to
 * press Ctrl+F5 after an update.
 * Must not change: only local .css and .js lines in the pages' own HTML are
 * touched; nothing in tools people upload; the stamp is letters and digits only.
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

let files = 0;
let lines = 0;
for (const dir of ['', 'admin']) {
  for (const name of (await readdir(join(ROOT, dir))).filter((f) => f.endsWith('.html'))) {
    const path = join(ROOT, dir, name);
    const html = await readFile(path, 'utf8');
    const out = html.replace(/\b(href|src)="((?!https?:|\/\/|data:)[^"?#]+\.(?:css|js))(?:\?v=[a-z0-9]+)?"/g, (m, attr, file) => { lines += 1; return attr + '="' + file + '?v=' + stamp + '"'; });
    if (out !== html) { await writeFile(path, out); files += 1; }
  }
}
console.log('Stamp ' + stamp + ' on ' + lines + ' lines in ' + files + ' pages.');
