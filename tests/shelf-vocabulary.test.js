/**
 * Guard: the slide-library / slide-collections axis that says *where a saved
 * slide or collection lives* — a person's private shelf or the shared
 * organization shelf — is `shelf`, values `'personal' | 'organization'`
 * (B53 sweep (b), D27; register in docs/reference/vocabulary.md).
 *
 * Before the sweep this axis was a third spelling of `scope`, colliding with
 * the storage-scope concept (`server/storage/scope.js`) — the two even shared a
 * function signature (`listSlideLibrary(ctx, { scope })` where `ctx` came from a
 * `storageScope`). The field is now `shelf`; the shared value is `'organization'`
 * (matching presentation `visibility`, migration 074), and the internal route
 * segment `/team` became `/organization`.
 *
 * This gate pins the loser spelling to zero on the surfaces that carry the
 * shelf axis, per file, so it cannot creep back. `scope` remains legitimate for
 * the storage-scope concept, so the server files below use precise needles
 * rather than a blanket `/scope/i`. "Team" survives only as a UI label
 * (`t('slideLibrary.shelf.organization', 'Team')`) and as label buckets in
 * ad-hoc response shapes — the value in stored data and the field name are
 * `organization` / `shelf`.
 *
 * The migration is stored-data: deploying this needs migration 076 to run
 * (`slide_library.scope`/`slide_collections.scope` → `shelf`, `'team'` →
 * `'organization'`).
 *
 * NOT covered: the public v1 API, which never exposed this field
 * (`sanitizeLibraryItem` omits it) and stays scope-free.
 *
 * Run with: node --test tests/shelf-vocabulary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

// Per-file scans. Each `forbidden` needle must match nowhere; each `required`
// needle must match somewhere (proves the canonical `shelf` landed).
const CHECKS = [
  // ─── server data layer: precise needles (these files legitimately say
  //     "storage scope" in prose and take a storageScope argument) ───────────
  {
    file: 'server/storage/mappers.js',
    forbidden: [{ label: 'shelf mapped as scope (use shelf: row.shelf)', re: /scope:\s*row\.scope/ }],
    required: [/shelf:\s*row\.shelf/],
  },
  {
    file: 'server/storage/adapters/postgres/slides.js',
    forbidden: [
      { label: "WHERE on a 'scope' column (use 'shelf')", re: /where\('scope'/ },
      { label: 'opts.scope shelf filter (use opts.shelf)', re: /opts\?\.scope\b/ },
      { label: 'INSERT scope value (use shelf)', re: /scope:\s*data\.scope/ },
    ],
    required: [/where\('shelf'/],
  },
  {
    file: 'server/storage/slide-library/index.js',
    forbidden: [
      { label: 'shelf option/field spelled scope (use shelf)', re: /\bscope:/ },
      { label: 'item.scope shelf read (use item.shelf)', re: /\.scope\b/ },
    ],
    required: [/shelf:\s*'organization'/, /shelf:\s*'personal'/],
  },
  {
    // B79/D34 folded the Kysely queries here from the deleted
    // adapters/postgres/collections.js, so this file now also carries the
    // where('shelf') / no-where('scope') guard the adapter used to.
    file: 'server/storage/collections/index.js',
    forbidden: [
      { label: 'shelf option/field spelled scope (use shelf)', re: /\bscope:/ },
      { label: 'existing.scope / item.scope shelf read (use .shelf)', re: /\.scope\b/ },
      { label: "WHERE on a 'scope' column (use 'shelf')", re: /where\('scope'/ },
    ],
    required: [/shelf:\s*'organization'/, /shelf:\s*'personal'/, /where\('shelf'/],
  },
  // ─── internal API route segments: /team became /organization ─────────────
  {
    file: 'server/routes/api/slide-library.js',
    forbidden: [{ label: 'old /slide-library/team route segment (use /organization)', re: /slide-library[/\\]+team\b/ }],
    required: [/slide-library[/\\]+organization\b/],
  },
  {
    file: 'server/routes/api/slide-collections.js',
    forbidden: [{ label: 'old /slide-collections/team route segment (use /organization)', re: /slide-collections[/\\]+team\b/ }],
    required: [/slide-collections[/\\]+organization\b/],
  },
  // ─── client shelf-axis modules: fully renamed, so a blanket scan holds ────
  {
    file: 'client/lib/slide-library/state.js',
    forbidden: [{ label: 'scope-as-shelf in the library state module (use shelf)', re: /scope/i }],
    required: [/\bshelf\b/, /organization/],
  },
  {
    file: 'client/lib/slide-library/api.js',
    forbidden: [{ label: 'scope-as-shelf in the library api module (use shelf)', re: /scope/i }],
    required: [/\bshelf\b/],
  },
  {
    file: 'client/lib/slide-collections/api.js',
    forbidden: [{ label: 'scope-as-shelf in the collections api module (use shelf)', re: /scope/i }],
    required: [/\bshelf\b/, /organization/],
  },
];

test('shelf vocabulary: the slide-library/collections axis is `shelf`, never scope', () => {
  const violations = [];
  for (const { file, forbidden = [] } of CHECKS) {
    const lines = fs.readFileSync(path.join(repoRoot, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { label, re } of forbidden) {
        if (re.test(line)) violations.push(`${file}:${i + 1}  [${label}]  ${line.trim()}`);
      }
    });
  }
  assert.equal(
    violations.length,
    0,
    `One word per meaning (docs/reference/vocabulary.md):\n  ${violations.join('\n  ')}`
  );
});

test('the canonical `shelf` spelling is present on every renamed surface', () => {
  for (const { file, required = [] } of CHECKS) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    for (const re of required) {
      assert.ok(re.test(text), `${file} must carry the canonical shelf spelling (${re})`);
    }
  }
});
