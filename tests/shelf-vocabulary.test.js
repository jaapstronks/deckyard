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
 * **Doc prose (B88).** The register lives in docs, so the docs are a surface
 * too: `DOC_PROSE` below scans every `docs/reference/**.md` for the loser
 * spellings of *this axis* — "team library/shelf/slides", "team-scope", the
 * `personal | team` value pair, `scope: personal`. The needles are that
 * precise on purpose. A blanket `\bteam\b` would drown in the `team-cards`
 * slide type, `--team-gap-x` CSS locals, "Leadership Team" sample content and
 * Notion/Microsoft Teams references, all of which are legitimate.
 *
 * Two files are exempt, for opposite reasons: `vocabulary.md` is the register
 * itself and must be able to name the loser spelling to forbid it, and
 * `collab-research.md` is a deliberately frozen phase-0 snapshot (the same
 * allowlist reason `tests/docs-paths-resolvable.test.js` carries).
 *
 * Also NOT covered, and deliberately: the ten storage exports still *named*
 * `listTeamLibrary` / `getTeamCollection` / … . B53 renamed the field, the
 * values and the route segment but not the function names, so those are a
 * real remainder rather than something this gate should pretend away — see
 * the B53 remainder item in docs/plans/TODO.md.
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
    // B79/D34 folded both the Kysely queries and the row mapper here from the
    // deleted adapters/postgres/slides.js (+ its mapSlideLibraryRow, which left
    // mappers.js), so this file now carries the where('shelf') /
    // no-where('scope') and shelf:row.shelf mapper guards the adapter used to.
    file: 'server/storage/slide-library/index.js',
    forbidden: [
      { label: 'shelf option/field spelled scope (use shelf)', re: /\bscope:/ },
      { label: 'item.scope / opts.scope shelf read (use .shelf)', re: /\.scope\b/ },
      { label: "WHERE on a 'scope' column (use 'shelf')", re: /where\('scope'/ },
      { label: 'shelf mapped as scope (use shelf: row.shelf)', re: /scope:\s*row\.scope/ },
    ],
    required: [/shelf:\s*'organization'/, /shelf:\s*'personal'/, /where\('shelf'/, /shelf:\s*row\.shelf/],
  },
  {
    // B79/D34 folded both the Kysely queries and the row mapper here from the
    // deleted adapters/postgres/collections.js (+ its mapSlideCollectionRow,
    // which left mappers.js), so this file now carries the where('shelf') /
    // no-where('scope') and shelf:row.shelf mapper guards the adapter used to.
    file: 'server/storage/collections/index.js',
    forbidden: [
      { label: 'shelf option/field spelled scope (use shelf)', re: /\bscope:/ },
      { label: 'existing.scope / item.scope shelf read (use .shelf)', re: /\.scope\b/ },
      { label: "WHERE on a 'scope' column (use 'shelf')", re: /where\('scope'/ },
      { label: 'shelf mapped as scope (use shelf: row.shelf)', re: /scope:\s*row\.scope/ },
    ],
    required: [/shelf:\s*'organization'/, /shelf:\s*'personal'/, /where\('shelf'/, /shelf:\s*row\.shelf/],
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

// ─── doc prose (B88) ────────────────────────────────────────────────────────

// Every `docs/reference/**.md` is scanned for the shelf axis's loser spellings.
// Needles stay narrow: `team-cards` (a slide type), `--team-gap-x` (CSS locals),
// sample deck copy and third-party products all say "team" legitimately.
const DOC_PROSE = {
  dir: path.join('docs', 'reference'),
  exempt: new Set([
    // The register itself: it names the loser spelling in order to forbid it.
    'vocabulary.md',
    // A deliberately frozen phase-0 snapshot, allowlisted the same way in
    // tests/docs-paths-resolvable.test.js.
    'collab-research.md',
  ]),
  forbidden: [
    { label: 'team library/shelf (the shared shelf is the organization shelf)', re: /\bteam[- ](librar(y|ies)|shelf|shelves)\b/i },
    { label: 'team slides/collections (say organization-shelf)', re: /\bteam[- ](slides?|collections?)\b/i },
    { label: 'team-scope (the axis is shelf; the value is organization)', re: /\bteam[- ]scoped?\b/i },
    { label: "the 'personal | team' value pair (use 'personal' | 'organization')", re: /personal['"`]?\s*\|\s*['"`]?team\b/i },
    { label: 'scope-as-shelf value (the field is shelf)', re: /\bscope:\s*['"`]?(personal|team)\b/i },
    // Anchored on /api/ so it catches the retired route segment without
    // flagging `slide-library/team.json`, the bulk-export ZIP entry — that
    // filename still says "team" in code, so documenting it truthfully is
    // right until the code-side rename lands.
    { label: 'old /api/slide-library/team or /api/slide-collections/team segment', re: /\/api\/slide-(library|collections)\/team\b/ },
  ],
};

function referenceDocs() {
  const abs = path.join(repoRoot, DOC_PROSE.dir);
  const out = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md') && !DOC_PROSE.exempt.has(entry.name)) out.push(full);
    }
  })(abs);
  return out;
}

test('shelf vocabulary: reference prose says shelf/organization, never team-as-shelf', () => {
  const violations = [];
  for (const file of referenceDocs()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { label, re } of DOC_PROSE.forbidden) {
        if (re.test(line)) violations.push(`${rel}:${i + 1}  [${label}]  ${line.trim()}`);
      }
    });
  }
  assert.equal(
    violations.length,
    0,
    `One word per meaning (docs/reference/vocabulary.md):\n  ${violations.join('\n  ')}`
  );
});

test('the doc-prose exemptions still exist, so the list cannot rot', () => {
  for (const name of DOC_PROSE.exempt) {
    const abs = path.join(repoRoot, DOC_PROSE.dir, name);
    assert.ok(fs.existsSync(abs), `${DOC_PROSE.dir}/${name} is exempt but no longer exists`);
  }
});
