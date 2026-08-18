/**
 * Guard: the deck listing filter that answers "which decks to include —
 * owned, shared, or all" is `ownership`, one word for one meaning (B53
 * sweep (a), D27; register in docs/reference/vocabulary.md).
 *
 * Before the sweep this concept had two spellings that both collided with
 * settled register words:
 *
 *   - `scope` on the MCP `list_presentations` / `list_recent_comments`
 *     filters and the client presentations view — `scope` is reserved for
 *     the storage-scope concept (`server/storage/scope.js`).
 *   - `visibility` as the owned/shared/all option inside
 *     `server/storage/presentations/comments.js` — `visibility` is reserved
 *     for a deck's audience (`'private' | 'organization'`).
 *
 * Both are pinned to zero here, per file, so they cannot creep back. The
 * MCP schema break is deliberate (near-zero installed base; MCP clients
 * re-read the tool schema each session) — no back-compat alias.
 *
 * NOT covered here: sweep (b) (the slide-library/collections `scope` shelf
 * axis → `shelf`), which shipped separately and has its own gate
 * (`tests/shelf-vocabulary.test.js`); and sweep (c) (the comments panel's
 * local slide/deck toggle, which stays). `scope` remains legitimate elsewhere
 * — this gate only scans the surfaces that carry the ownership filter.
 *
 * **Doc prose (B88).** The register lives in docs, so the docs are a surface
 * too: `docs/reference/**.md` is scanned for the ownership filter spelled
 * `scope` or `visibility`. Unlike the shelf and organization axes, this one
 * came back clean at the time it was added — the section is preventive, and
 * the needles are adjacency-based (`scope: owned`, `visibility: shared`)
 * because bare `scope` and bare `visibility` are both legitimate words for
 * other meanings on nearly every page. `vocabulary.md` is exempt as the
 * register itself; `collab-research.md` as a deliberately frozen phase-0
 * snapshot (the same allowlist reason `tests/docs-paths-resolvable.test.js`
 * carries).
 *
 * Run with: node --test tests/listing-filter-vocabulary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

// Per-file scans. `forbidden` needles must match nowhere; each `required`
// needle must match somewhere (proves the canonical `ownership` landed).
const CHECKS = [
  {
    file: 'client/views/list/views/presentations-view.js',
    // The whole view is renamed: it names nothing "scope" anymore.
    forbidden: [
      { label: 'scope-as-ownership (use ownership) in the presentations view', re: /scope/i },
    ],
    required: [/\bownership\b/],
  },
  {
    file: 'server/mcp/tools.js',
    forbidden: [
      { label: "scope: {…} listing-filter schema property (use ownership)", re: /\bscope:\s*\{/ },
      { label: 'validScope (use validOwnership)', re: /validScope/ },
      { label: "scope = 'owned' | 'all' listing default (use ownership)", re: /\bscope\s*=\s*'(owned|all)'/ },
    ],
    // Both list tools declare the ownership filter.
    required: [/ownership:\s*\{/],
  },
  {
    file: 'server/storage/presentations/comments.js',
    // Every use of "visibility" in this comments module was the ownership
    // homonym; the real visibility concept lives elsewhere.
    forbidden: [
      { label: 'visibility as the owned/shared/all ownership filter (use ownership)', re: /\bvisibility\b/ },
    ],
    required: [/\bownership\b/],
  },
  {
    file: 'client/styles/base/02-lists-and-thumbs/80-tags.css',
    forbidden: [
      { label: 'scope-filter CSS class (use ownership-filter)', re: /scope-filter/ },
    ],
    required: [/ownership-filter/],
  },
  {
    file: 'client/i18n/en/list.json',
    forbidden: [{ label: 'list.presentations.scope i18n key (use ownership)', re: /list\.presentations\.scope/ }],
    required: [/list\.presentations\.ownership/],
  },
  {
    file: 'client/i18n/nl/list.json',
    forbidden: [{ label: 'list.presentations.scope i18n key (use ownership)', re: /list\.presentations\.scope/ }],
    required: [/list\.presentations\.ownership/],
  },
];

test('listing filter vocabulary: the deck source filter is `ownership`, never scope/visibility', () => {
  const violations = [];
  for (const { file, forbidden = [] } of CHECKS) {
    const abs = path.join(repoRoot, file);
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
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

test('the canonical `ownership` spelling is present on every renamed surface', () => {
  for (const { file, required = [] } of CHECKS) {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    for (const re of required) {
      assert.ok(re.test(text), `${file} must carry the canonical ownership spelling (${re})`);
    }
  }
});

// ─── doc prose (B88) ────────────────────────────────────────────────────────

const DOC_DIR = path.join('docs', 'reference');
const DOC_EXEMPT = new Set([
  // The register itself: it names the loser spelling in order to forbid it.
  'vocabulary.md',
  // A deliberately frozen phase-0 snapshot, allowlisted the same way in
  // tests/docs-paths-resolvable.test.js.
  'collab-research.md',
]);

const DOC_FORBIDDEN = [
  {
    label: 'scope as the owned/shared/all listing filter (use ownership)',
    re: /\bscope['"`]?\s*[:=]\s*['"`]?(owned|shared|all)\b/i,
  },
  {
    label: 'visibility as the owned/shared/all listing filter (use ownership)',
    re: /\bvisibility['"`]?\s*[:=]\s*['"`]?(owned|shared|all)\b/i,
  },
  {
    label: 'MCP list tool documented with a scope filter (use ownership)',
    re: /list_(presentations|recent_comments)[^\n]*\bscope\b/,
  },
];

function referenceDocs() {
  const out = [];
  (function walkDocs(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkDocs(full);
      else if (entry.name.endsWith('.md') && !DOC_EXEMPT.has(entry.name)) out.push(full);
    }
  })(path.join(repoRoot, DOC_DIR));
  return out;
}

test('listing filter vocabulary: reference prose says ownership, never scope/visibility', () => {
  const violations = [];
  for (const file of referenceDocs()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const { label, re } of DOC_FORBIDDEN) {
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
  for (const name of DOC_EXEMPT) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, DOC_DIR, name)),
      `${DOC_DIR}/${name} is exempt but no longer exists`
    );
  }
});
