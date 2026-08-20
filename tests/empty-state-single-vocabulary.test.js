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
 * state class, or on the burndown allowlist below.
 *
 * Burndown (PR E2 of the cluster): migrate an allowlisted site to
 * `.empty-note` (or the block helper where it really is a block), fold its
 * CSS, and remove its entry here. The allowlist should shrink to just the
 * `compare-empty` entry.
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
  'empty-note',
  'is-empty',
  'non-empty',
]);

// file (relative to repo root) -> tokens still tolerated there.
// PERMANENT: versions-compare's `compare-empty` is a "—" placeholder cell in
// the version diff table — a table cell, not an empty state; it stays.
// The rest is the E2 burndown list.
const ALLOWLIST = {
  'client/views/editor/modals/versions-compare.js': ['compare-empty'],
  // --- E2 burndown from here down ---
  'client/lib/slide-library/picker.js': ['ps-lib-empty'],
  'client/lib/slide-collections/collections-bar.js': ['collections-bar-empty'],
  'client/lib/comments/mention-autocomplete.js': ['mention-autocomplete-empty'],
  'client/views/viewer/viewer-preview.js': ['viewer-empty'],
  'client/views/share-viewer/index.js': ['share-viewer-empty'],
  'client/views/share-viewer/viewer-comments.js': [
    'share-viewer-comments-empty',
  ],
  'client/views/settings/slide-type-editor/field-editor.js': [
    'field-list-empty',
  ],
  'client/views/settings/api-keys/key-list.js': ['api-keys-empty-state'],
  'client/views/list/tag-filter.js': ['tag-filter-empty'],
  'client/views/list/views/search-view.js': ['search-empty-state'],
  'client/views/analytics/top-presentations.js': ['dashboard-empty'],
  'client/views/analytics/dashboard.js': ['dashboard-empty'],
  'client/views/analytics/dashboard-chart.js': ['dashboard-chart-empty'],
  'client/views/editor/comments-panel-renderers.js': ['comments-empty'],
  'client/views/editor/slide-list.js': ['slides-search-empty'],
  'client/views/editor/bundled-gradients/picker.js': ['stock-media-empty'],
  'client/views/editor/fields/icon-picker-modal.js': ['icon-picker-empty'],
  'client/views/editor/modals/share-modal/collaborators-section.js': [
    'share-collaborators-empty',
  ],
  'client/views/editor/modals/share-modal/share-links-section.js': [
    'share-links-empty',
  ],
  'client/views/editor/modals/share-modal/guest-management.js': [
    'share-guest-empty',
  ],
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
