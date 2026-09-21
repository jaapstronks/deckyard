/**
 * A field has one name, and the schema holds the key to it (B395).
 *
 * The inline editor names a field in three places — a ghost chip ("+ Caption"),
 * a clear button's title and the markdown modal's label — and all three go
 * through `fieldLabel()`. It used to resolve that name under
 * `editor.inline.field.<last path segment>`: a second key scheme for a concept
 * the registry already keys, stamping `labelKey` on every field
 * (shared/ui-i18n-keys.js) for the inspector to render from.
 *
 * The second scheme had **zero** entries in all twelve locales, so every chip
 * fell through to `meta.label` — the English schema label. On a Dutch canvas
 * "+ Caption" stood in English next to "+ Rij toevoegen". It could not have
 * worked as written either: keying on the last path segment collapses fields
 * that merely share a final name, so a single `title` entry would have had to
 * serve `comparison-slide`'s "Title", `team-cards-slide`'s and a text-blocks
 * row's at once. `labelKey` is now the only scheme and the dead namespace is
 * gone; this pins both.
 *
 * On locales: Tier 1 (`nl`, `en`) is the gated promise, so every ghost field's
 * key must exist there. Tier 2 is best effort by design — an untranslated key
 * is *absent*, not a copy of the English (D73) — so a Tier-2 gap is a
 * translation backlog item, not a defect of this wiring. The canonical
 * statement is docs/reference/i18n-locale-tiers.md.
 *
 * Run with: node --test tests/inline-ghost-label-keys.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { INLINE_DESCRIPTORS } from '../client/views/editor/inline-edit/descriptors.js';
import {
  fieldMetaForPath,
  fieldLabel,
} from '../client/views/editor/inline-edit/field-path.js';
import { setUiLocale } from '../client/lib/ui-i18n.js';
import { loadLocale, I18N_DIR } from '../scripts/lib/i18n-fs.js';
import { TIER_1 } from '../scripts/lib/i18n-locales.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');

/** The retired namespace, in the one spelling it ever had. */
const DEAD_NAMESPACE = 'editor.inline.field.';

// ---------------------------------------------------------------- behaviour

/**
 * Load a real locale into the `t()` dictionary. `setUiLocale` fetches the
 * module JSON over HTTP, so the stub serves the same files off disk — the
 * dictionary under test is the one the browser gets, not a fixture.
 * @param {string} locale
 */
async function withLocale(locale) {
  globalThis.fetch = async (url) => {
    const rel = String(url).replace(/^\/+/, '').split('?')[0];
    const body = fs.readFileSync(path.join(repoRoot, rel), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  };
  await setUiLocale(locale, { persist: false });
}

test('a Dutch canvas names a ghost field in Dutch', async () => {
  // The B395 symptom, at its smallest: `callout-slide`'s `body` chip read
  // "Tekst" in the inspector and "Body" on the canvas, because the canvas asked
  // a key scheme nothing filled and fell through to the schema label. One key
  // now, so both say "Tekst".
  await withLocale('nl');
  const meta = fieldMetaForPath(SLIDE_TYPES['callout-slide'], 'body');
  assert.equal(
    meta.label,
    'Body',
    'the schema label is what the chip used to show',
  );
  assert.equal(fieldLabel('body', meta), 'Tekst');
});

test('an English canvas still gets the English name', async () => {
  await withLocale('en');
  const meta = fieldMetaForPath(SLIDE_TYPES['callout-slide'], 'body');
  assert.equal(fieldLabel('body', meta), 'Body');
});

test('fieldLabel names the field, not the path segment it arrived on', async () => {
  await withLocale('nl');
  const meta = fieldMetaForPath(SLIDE_TYPES['timeline-slide'], 'items.0.text');
  assert.equal(
    fieldLabel('items.7.text', meta),
    fieldLabel('items.0.text', meta),
    'an item index is not part of a field name',
  );
  assert.notEqual(fieldLabel('items.0.text', meta), 'text');
});

test('fieldLabel falls back to the schema label when a field has no key', () => {
  assert.equal(
    fieldLabel('caption', { key: 'caption', label: 'Caption' }),
    'Caption',
  );
});

test('a path the schema does not know names itself, never the empty string', () => {
  // t('') answers '' — asking it for an absent key would blank the chip.
  assert.equal(fieldLabel('items.0.mystery', {}), 'mystery');
  assert.equal(fieldLabel('mystery', undefined), 'mystery');
});

// -------------------------------------------------------------- ghost fields

/**
 * Every field path that gets a ghost affordance, across every registered slide
 * type — the `ghosts` and `itemGhosts` blocks of the 28 inline-edit companions.
 * @returns {Array<{type: string, path: string, meta: Object}>}
 */
function ghostFields() {
  const out = [];
  for (const [type, descriptor] of Object.entries(INLINE_DESCRIPTORS)) {
    const def = SLIDE_TYPES[type];
    if (!def) continue;
    const paths = [
      ...(descriptor.ghosts || []).map((g) => g.field),
      ...(descriptor.itemGhosts || []).map((g) => `${g.list}.0.${g.field}`),
    ];
    for (const p of paths) {
      const meta = fieldMetaForPath(def, p);
      // A shared ghost set (HEADER_GHOSTS) may name a field a type lacks;
      // insertGhosts() skips those, so they carry no label obligation.
      if (!meta || !meta.key) continue;
      out.push({ type, path: p, meta });
    }
  }
  return out;
}

test('every ghost field carries a labelKey', () => {
  const missing = ghostFields()
    .filter((f) => !f.meta.labelKey)
    .map((f) => `${f.type}  ${f.path}`);
  assert.deepEqual(
    missing,
    [],
    'the registry stamps labelKey on every field with a key ' +
      '(shared/ui-i18n-keys.js); a ghost field without one would silently ' +
      'render its English schema label in all twelve locales:\n' +
      missing.join('\n'),
  );
});

test('every ghost field key is translated in Tier 1', async () => {
  const dicts = {};
  for (const locale of TIER_1)
    dicts[locale] = await loadLocale(I18N_DIR, locale);

  const gaps = [];
  for (const f of ghostFields()) {
    for (const locale of TIER_1) {
      if (typeof dicts[locale][f.meta.labelKey] !== 'string')
        gaps.push(`${locale}  ${f.type}  ${f.path}  ${f.meta.labelKey}`);
    }
  }
  assert.deepEqual(
    gaps,
    [],
    `${gaps.length} ghost chip(s) would render their English schema label in a ` +
      'Tier-1 locale. Add the key to client/i18n/<locale>/:\n' +
      gaps.slice(0, 20).join('\n'),
  );
});

test('ghost fields that share a last path segment keep distinct keys', () => {
  // The defect the old scheme could not avoid: `editor.inline.field.title`
  // was one entry for every field whose path ends in `title`. If this ever
  // finds no collision the pin has gone slack — the scheme is only provably
  // better than the old one while fields that share a segment exist.
  const bySegment = new Map();
  for (const f of ghostFields()) {
    const segment = f.path.split('.').pop();
    if (!bySegment.has(segment)) bySegment.set(segment, new Set());
    bySegment.get(segment).add(f.meta.labelKey);
  }
  const collisions = [...bySegment].filter(([, keys]) => keys.size > 1);
  assert.ok(
    collisions.length > 0,
    'no ghost field shares a last path segment with a differently-labelled ' +
      'one, so this test no longer demonstrates anything',
  );
  for (const [segment, keys] of collisions) {
    assert.ok(
      keys.size > 1,
      `"${segment}" resolves to ${keys.size} key(s): ${[...keys].join(', ')}`,
    );
  }
});

// -------------------------------------------------------------------- guard

test('guard: the editor.inline.field.* namespace is gone and stays gone', () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'vendor') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /\.(js|json)$/.test(entry.name)) {
        const rel = path.relative(repoRoot, full).split(path.sep).join('/');
        fs.readFileSync(full, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            const trimmed = line.trimStart();
            // This file argues about the namespace by name.
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
            if (line.includes(DEAD_NAMESPACE)) hits.push(`${rel}:${i + 1}`);
          });
      }
    }
  };
  walk(path.join(repoRoot, 'client'));

  assert.deepEqual(
    hits,
    [],
    `${DEAD_NAMESPACE}* is a retired key scheme. A field's name comes from ` +
      'its own labelKey, so the inspector and the canvas cannot drift apart:\n' +
      hits.join('\n'),
  );
});
