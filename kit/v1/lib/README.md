# The shelf: libraries the platform provides

A tool may not load anything from outside the site. When many tools need the same well-known library, IT puts one checked copy here and every tool uses that copy. A tool carries no copy of its own, so there is one version to watch and to update.

| Library | Version | For | Licence | Line a tool writes |
|---|---|---|---|---|
| ExcelJS | 4.4.0 | Read and write Excel files (.xlsx) | MIT | `<script src="/_dame/v1/lib/exceljs.js"></script>` |

How it works: the tool writes the line; at load the shell replaces it with the file from this folder, inside the sealed frame. The library runs with the tool's rights: no network, no session, no storage.

Adding or updating a library (IT only):
1. Take the file from the publisher's own package, unchanged. Record where it came from and its SHA-256 in `index.json`.
2. Check the licence allows this use and put its text beside the file.
3. Check the file works without `eval` and without any outside call (the sealed frame forbids both), and contains no closing script tag.
4. Add it to `index.json` with a short "how to use" for the AI prompt. Run `node tests/phase0.mjs` and `node tests/browser/phase3.mjs`.
5. A new major version gets a new id (for example `exceljs5`), so tools built on the old one keep working.

`exceljs.js` is the file `dist/exceljs.bare.min.js` of the npm package `exceljs` 4.4.0, byte for byte.
