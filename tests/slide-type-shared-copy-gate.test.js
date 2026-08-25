/**
 * One text, one key (B146 / D60): the slide-type registry may not say the same
 * thing twice.
 *
 * Two set operations over the core registry, both cheap:
 *
 *  1. **No two `slideType.*` keys share a (shape, English text) pair.** "Shape"
 *     is the key with its type segment removed, so `field.title.label` on
 *     twenty-four types is one shape and one text — twenty-four keys where one
 *     would do, and twenty-four rows in front of eleven translators. The fix is
 *     never a second spelling: the field points at the shared
 *     `editor.slideField.*` key for that text (see `shared/slide-types/helpers.js`
 *     and `shared/ui-i18n-keys.js#sharedOption`).
 *  2. **No option carries one text under two keys.** An option has three copy
 *     slots (`label`/`title`/`ariaLabel`); when they say the same thing they
 *     must point at the same key, which is what `sharedOption()` guarantees.
 *     Three keys for one text is how 208 of them got minted before B145/#985.
 *
 * Both land with a burndown allowlist that may only ever shrink — the
 * `eslint-suppressions.json` / A7.20 pattern. It starts empty: the fold that
 * introduced these gates finished the job (621 registry keys → 374, `en/`
 * 387 → 221), so any entry added later is a regression someone chose.
 *
 * **Core only.** `CORE_SLIDE_TYPE_DEFS`, not the merged registry: a fork's copy
 * is the fork's business, and a fork type must not be able to fail this repo's
 * CI — the same rule `i18n-fill.js` follows for the tracked `en/` artifact.
 *
 * Run with: node --test tests/slide-type-shared-copy-gate.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CORE_SLIDE_TYPE_DEFS } from '../shared/slide-types/registry.js';
import {
  addUiI18nKeysToSlideType,
  normalizeOption,
} from '../shared/ui-i18n-keys.js';
import { slideTypeUiStrings } from '../scripts/lib/slide-type-i18n-keys.js';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BURNDOWN_PATH = join(
  REPO_ROOT,
  'tests',
  'slide-type-shared-copy-burndown.json',
);

/**
 * Pure detector for gate 1: `slideType.*` keys that share a (shape, text) pair.
 *
 * @param {Record<string, object>} slideTypes - stamped slide-type definitions
 * @returns {string[]} sorted `"<shape> = <text>"` ids, one per repeated pair
 */
export function detectRepeatedCopy(slideTypes) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const [key, english] of slideTypeUiStrings(slideTypes)) {
    const m = /^slideType\.[^.]+\.(.*)$/.exec(key);
    if (!m) continue; // an explicit shared key is the fix, not a violation
    const id = `${m[1]} = ${english}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(key);
  }
  return [...groups]
    .filter(([, keys]) => keys.length > 1)
    .map(([id]) => id)
    .sort();
}

/**
 * Pure detector for gate 2: options whose copy slots say one thing under more
 * than one key.
 *
 * @param {Record<string, object>} slideTypes - stamped slide-type definitions
 * @returns {string[]} sorted `"<field key path>.option.<value>: <text>"` ids
 */
export function detectSplitOptionKeys(slideTypes) {
  const hits = [];
  const walk = (base, fields) => {
    for (const f of Array.isArray(fields) ? fields : []) {
      const fk = String(f?.key || '').trim();
      if (!fk) continue;
      const fbase = `${base}.${fk}`;
      for (const raw of Array.isArray(f?.options) ? f.options : []) {
        const opt = normalizeOption(raw);
        /** @type {Map<string, Set<string>>} text -> keys carrying it */
        const byText = new Map();
        for (const slot of ['label', 'title', 'ariaLabel']) {
          const key = opt[`${slot}Key`];
          if (!key) continue;
          const text = String(opt[slot] ?? '');
          if (!byText.has(text)) byText.set(text, new Set());
          byText.get(text).add(key);
        }
        for (const [text, keys] of byText) {
          if (keys.size > 1) hits.push(`${fbase}.option.${opt.value}: ${text}`);
        }
      }
      if (Array.isArray(f?.itemFields)) walk(`${fbase}.item`, f.itemFields);
    }
  };
  for (const [type, def] of Object.entries(slideTypes || {}))
    walk(`slideType.${type}.field`, def?.fields);
  return hits.sort();
}

const burndown = JSON.parse(readFileSync(BURNDOWN_PATH, 'utf8'));
const found = [
  ...detectRepeatedCopy(CORE_SLIDE_TYPE_DEFS),
  ...detectSplitOptionKeys(CORE_SLIDE_TYPE_DEFS),
].sort();

// ─── the gates ───────────────────────────────────────────────────────────────

test('no slide-type copy is minted twice: every repeat is on the burndown', () => {
  const allowed = new Set(burndown);
  assert.deepEqual(
    found.filter((id) => !allowed.has(id)),
    [],
    'the same English string is minted under more than one key. Point the ' +
      'field or option at the shared `editor.slideField.*` key for that text ' +
      '(shared/ui-i18n-keys.js#sharedOption), do not add a line to ' +
      'tests/slide-type-shared-copy-burndown.json — it only shrinks.',
  );
});

test('the burndown list only shrinks: every line is still a live repeat', () => {
  const present = new Set(found);
  assert.deepEqual(
    burndown.filter((id) => !present.has(id)),
    [],
    'these repeats are gone — delete their lines from ' +
      'tests/slide-type-shared-copy-burndown.json so the list keeps burning down',
  );
});

test('the burndown list is sorted and free of duplicates', () => {
  assert.deepEqual([...burndown].sort(), burndown, 'keep the list sorted');
  assert.equal(new Set(burndown).size, burndown.length, 'no duplicate lines');
});

// ─── negative self-tests: prove the detectors catch a violation ───────────────

const stamp = (types) =>
  Object.fromEntries(
    Object.entries(types).map(([t, d]) => [t, addUiI18nKeysToSlideType(t, d)]),
  );

test('detector flags one label minted on two types', () => {
  const hits = detectRepeatedCopy(
    stamp({
      a: { fields: [{ key: 'title', label: 'Title', type: 'string' }] },
      b: { fields: [{ key: 'title', label: 'Title', type: 'string' }] },
    }),
  );
  assert.deepEqual(hits, ['field.title.label = Title']);
});

test('detector ignores a shared editor.slideField key, and differing copy', () => {
  const shared = 'editor.slideField.title.label';
  const hits = detectRepeatedCopy(
    stamp({
      a: {
        fields: [
          { key: 'title', label: 'Title', labelKey: shared, type: 'string' },
        ],
      },
      b: {
        fields: [
          { key: 'title', label: 'Title', labelKey: shared, type: 'string' },
        ],
      },
      c: { fields: [{ key: 'title', label: 'Heading', type: 'string' }] },
    }),
  );
  assert.deepEqual(hits, []);
});

test('detector flags one option text carried by three keys', () => {
  const hits = detectSplitOptionKeys(
    stamp({
      a: {
        fields: [
          {
            key: 'fit',
            label: 'Fit',
            type: 'enum',
            options: [
              {
                value: 'cover',
                label: 'Fill',
                labelKey: 'x.label',
                title: 'Fill',
                titleKey: 'x.title',
                ariaLabel: 'Fill',
                ariaLabelKey: 'x.ariaLabel',
              },
            ],
          },
        ],
      },
    }),
  );
  assert.deepEqual(hits, ['slideType.a.field.fit.option.cover: Fill']);
});

test('detector allows three keys when the three slots say three things', () => {
  const hits = detectSplitOptionKeys(
    stamp({
      a: {
        fields: [
          {
            key: 'role',
            label: 'Role',
            type: 'enum',
            options: [
              {
                value: 'content',
                label: 'Meaningful',
                labelKey: 'x.label',
                title: 'This image conveys information.',
                titleKey: 'x.title',
                ariaLabel: 'Meaningful image',
                ariaLabelKey: 'x.ariaLabel',
              },
            ],
          },
        ],
      },
    }),
  );
  assert.deepEqual(hits, []);
});

test('detector descends into itemFields', () => {
  const hits = detectSplitOptionKeys(
    stamp({
      a: {
        fields: [
          {
            key: 'items',
            label: 'Items',
            type: 'items',
            itemFields: [
              {
                key: 'style',
                label: 'Style',
                type: 'enum',
                options: [
                  {
                    value: 'bold',
                    label: 'Bold',
                    labelKey: 'y.label',
                    title: 'Bold',
                    titleKey: 'y.title',
                  },
                ],
              },
            ],
          },
        ],
      },
    }),
  );
  assert.deepEqual(hits, [
    'slideType.a.field.items.item.style.option.bold: Bold',
  ]);
});
