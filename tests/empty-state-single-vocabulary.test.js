/**
 * Guard: one empty-state vocabulary (A7.16 cluster 3).
 *
 * Two sanctioned forms exist: the `.empty-state` block (built by
 * `client/lib/dom/empty-state.js` — icon + title + message + CTA) and the
 * `.empty-note` one-liner ("No slides", "No results" — plain
 * `h('div', { class: 'empty-note', text })`, deliberately no helper). Before
 * the consolidation, analytics, the activity feed and three settings tabs
 * each cloned the block under their own class names, and ~20 surfaces spelled
 * their own note class. This gate stops new spellings: any class token
 * containing "empty" in client JS must be one of the sanctioned tokens, a
 * state class, or on the short allowlist below.
 *
 * The burndown is done (PR E2): every one of those 20 sites now uses the
 * sanctioned vocabulary, so the allowlist holds only the one permanent
 * exception. Keep it that way — a new entry needs a reason, not a TODO.
 *
 * Run with: node --test tests/empty-state-single-vocabulary.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const CLIENT_DIR = path.join(repoRoot, 'client');

// The sanctioned vocabulary plus state/modifier classes that are about
// emptiness of a container, not an empty-state surface.
const SANCTIONED = new Set([
  'empty-state',
  'empty-state-icon',
  'empty-state-title',
  'empty-state-message',
  'empty-state-actions',
  'empty-state-panel',
  'empty-state-fill',
  'empty-note',
  'is-empty',
  'non-empty',
]);

// file (relative to repo root) -> tokens still tolerated there.
// PERMANENT: versions-compare's `compare-empty` is a "—" placeholder cell in
// the version diff table — a table cell, not an empty state; it stays.
const ALLOWLIST = {
  'client/views/editor/modals/versions-compare.js': ['compare-empty'],
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'vendor') continue;
      walk(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

const CLASS_LITERAL = /(?:class|className):\s*['"`]([^'"`]*)['"`]/g;

test('every "empty" class token is sanctioned or allowlisted', () => {
  const offenders = [];
  for (const file of walk(CLIENT_DIR)) {
    const rel = path.relative(repoRoot, file);
    const src = fs.readFileSync(file, 'utf8');
    const tolerated = new Set(ALLOWLIST[rel] || []);
    for (const match of src.matchAll(CLASS_LITERAL)) {
      for (const token of match[1].split(/\s+/)) {
        if (!token.includes('empty')) continue;
        if (SANCTIONED.has(token) || tolerated.has(token)) continue;
        offenders.push(`${rel}: ${token}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Unsanctioned empty-state class token(s):\n  ${offenders.join('\n  ')}\n` +
      'Use createEmptyState (client/lib/dom/empty-state.js) for block empty ' +
      'states or class "empty-note" for one-line placeholders — do not coin ' +
      'a new class name.',
  );
});

test('allowlist entries still exist (stale entries must be removed)', () => {
  const stale = [];
  for (const [rel, tokens] of Object.entries(ALLOWLIST)) {
    const full = path.join(repoRoot, rel);
    if (!fs.existsSync(full)) {
      stale.push(`${rel} (file gone)`);
      continue;
    }
    const src = fs.readFileSync(full, 'utf8');
    for (const token of tokens) {
      const used = [...src.matchAll(CLASS_LITERAL)].some((m) =>
        m[1].split(/\s+/).includes(token),
      );
      if (!used) stale.push(`${rel}: ${token}`);
    }
  }
  assert.deepEqual(
    stale,
    [],
    `Stale allowlist entr(y/ies) — migrated sites must drop off the list:\n  ${stale.join('\n  ')}`,
  );
});
