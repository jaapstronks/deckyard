/**
 * `server/storage/` folder shape: one folder = one seam (A7.36 PR 1, D57).
 *
 * `AGENTS.md` § _Module layout: one folder = one seam_ has said this since
 * before the tree drifted away from it, and § _`server/storage/` applies this
 * literally_ spells out what a storage path is supposed to tell you:
 *
 *   - `server/storage/X.js` — an **undecomposed** store: one module, one file.
 *   - `server/storage/X/index.js` — a **decomposed** store: a seam over concern
 *     modules (`X/list.js`, `X/crud.js`, …) that consumers never import
 *     directly.
 *
 * Two shapes break that reading, and this file refuses both:
 *
 *   1. A folder whose only file is `index.js` — a folder built around a module
 *     that was never decomposed. It reads as a seam and is not one. Six of
 *     these existed (`collections`, `image-library`, `published`,
 *     `slide-library`, `slide-library-usage`, `tags`); they are single files now.
 *   2. A multi-file folder with no `index.js` — a decomposed store with no
 *     seam, so every consumer picks its own entry point and the folder has no
 *     public API. `analytics/` was the last one.
 *
 * **Scope is the store level**: the direct children of `server/storage/`. That
 * is where the `server/storage/` paragraph in `AGENTS.md` applies — one folder
 * per store — and it is deliberately not recursive: `presentations/crud/` is a
 * sub-decomposition reached only by its own store's seam
 * (`presentations/index.js`), and a seam inside a seam would be ceremony, not
 * structure.
 *
 * **There is no allowlist**, on purpose. The previous scan found four of these
 * and they were still here at the next one; a burndown list would have carried
 * them a third time. The third rule the brief names — a tracked `P/X.js` beside
 * a folder `P/X/` — lands with A7.36 PR 2/3, which is what removes the seven
 * eponymous wrappers that would otherwise fail it on arrival.
 *
 * Not covered by either rule: a folder holding exactly one file that is *not*
 * `index.js` (`cache/permission-cache.js` today). Same disease as rule 1 —
 * a folder around an undecomposed module — but the brief states the rule as
 * "only an `index.js`", and widening it is a decision, not a lint fix.
 *
 * Run with: node --test tests/storage-module-layout.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const storageRoot = path.join(here, '..', 'server', 'storage');

/**
 * The direct child folders of `server/storage/`, each with its own file names.
 * @returns {Array<{name: string, files: string[]}>}
 */
function storeFolders() {
  return fs
    .readdirSync(storageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      files: fs
        .readdirSync(path.join(storageRoot, entry.name), {
          withFileTypes: true,
        })
        .filter((f) => f.isFile())
        .map((f) => f.name),
    }));
}

test('no folder under server/storage/ holds nothing but an index.js', () => {
  const offenders = storeFolders()
    .filter((d) => d.files.length === 1 && d.files[0] === 'index.js')
    .map((d) => `server/storage/${d.name}/`);

  assert.deepEqual(
    offenders,
    [],
    `A folder around a single undecomposed module is not a seam — move it to ` +
      `server/storage/<name>.js (AGENTS.md § Module layout):\n  ` +
      offenders.join('\n  '),
  );
});

test('every multi-file folder under server/storage/ has an index.js seam', () => {
  const offenders = storeFolders()
    .filter((d) => d.files.length > 1 && !d.files.includes('index.js'))
    .map((d) => `server/storage/${d.name}/ (${d.files.length} files)`);

  assert.deepEqual(
    offenders,
    [],
    `A decomposed store needs one public seam — add an index.js barrel and ` +
      `point consumers at it (AGENTS.md § Module layout):\n  ` +
      offenders.join('\n  '),
  );
});
