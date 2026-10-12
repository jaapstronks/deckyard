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
 * state class.
 *
 * The burndown is done: the empty-state sites now use the
 * sanctioned vocabulary. This test also pins the messages that used
 * `.help`, which a class-name-only scan cannot detect.
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
    for (const match of src.matchAll(CLASS_LITERAL)) {
      for (const token of match[1].split(/\s+/)) {
        if (!token.includes('empty')) continue;
        if (SANCTIONED.has(token)) continue;
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

test('empty messages use the shared note style', () => {
  const sites = {
    'client/views/settings/organization-members/member-list.js': [
      'organization.members.empty',
    ],
    'client/views/list/views/trash-view.js': ['list.trash.empty'],
    'client/views/list/views/presentations-view.js': [
      'list.presentations.noMatch',
      'list.presentations.empty',
    ],
    'client/views/editor/image-library/grid.js': [
      'imageLibrary.noResults',
      'imageLibrary.empty',
    ],
    'client/views/editor/imagekit-picker/index.js': ['imagekit.noResults'],
    'client/views/editor/modals/versions-modal.js': ['editor.versions.empty'],
  };
  const offenders = [];
  for (const [rel, keys] of Object.entries(sites)) {
    const src = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    for (const key of keys) {
      const pos = src.indexOf(`'${key}'`);
      const element = src.lastIndexOf("h('div', {", pos);
      const props = src.slice(element, pos);
      if (pos < 0 || element < 0 || !/class: 'empty-note'/.test(props)) {
        offenders.push(`${rel}: ${key}`);
      }
    }
  }
  const picker = fs.readFileSync(
    path.join(repoRoot, 'client/views/editor/slide-type-picker/index.js'),
    'utf8',
  );
  assert.match(
    picker,
    /const noResults = h\('div', \{ class: 'empty-note', hidden: true \}\)/,
  );
  assert.match(picker, /noResults\.append\(noResultsText\)/);
  assert.match(picker, /'editor\.slideTypePicker\.noResults'/);
  assert.deepEqual(offenders, []);
  const compare = fs.readFileSync(
    path.join(repoRoot, 'client/views/editor/modals/versions-compare.js'),
    'utf8',
  );
  assert.equal(
    compare.match(/class: 'empty-note compare-placeholder'/g)?.length,
    2,
  );
});
