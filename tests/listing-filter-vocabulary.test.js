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
