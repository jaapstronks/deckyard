import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SLIDE_TYPES,
  CORE_SLIDE_TYPE_NAMES,
  GLOBAL_SLIDE_FIELD_KEYS,
} from '../shared/slide-types/registry.js';
import {
  SLIDE_STRUCTURE_NAMES,
  isSlideStructure,
  slideStructure,
} from '../shared/slide-types/structure.js';

/**
 * The `structure` facet's guardrail — assertions 1 and 2 of brief B.
 *
 * The point of starting with `structure` rather than `intent` is that it is
 * *derivable*: the declaration says what shape the content has, and the field
 * schema already knows. So a lie is detectable, and these tests are what make
 * the declaration worth more than a comment.
 *
 * Assertions 3 (no two active types share a field signature), 4 (every layout
 * variant carries the same content-bearing fields) and 5 (the companion matrix
 * has no hole) are a separate change — each finds real violations and needs its
 * own burndown.
 */

const GLOBAL = new Set(GLOBAL_SLIDE_FIELD_KEYS);

/**
 * Fields that carry the slide's content: live (not a legacy mirror), not one of
 * the globals every type gets, and not `actions[]`.
 *
 * `actions[]` is the interesting exclusion. `content-slide` and
 * `image-text-slide` both carry an `actions[0-3]` array beside their scalar
 * slots, and by field type that makes them collections — but a call-to-action
 * affordance is not a content shape. It belongs with the global fields
 * `withGlobalSlideFields()` injects, and moving it there is a proposal in the
 * brief. Until that lands, the exclusion is written down here rather than
 * silently distorting the facet.
 */
function contentFields(def) {
  return (def?.fields || []).filter(
    (f) =>
      f &&
      typeof f.key === 'string' &&
      f.hidden !== true &&
      f.deprecated !== true &&
      !GLOBAL.has(f.key) &&
      f.key !== 'actions' &&
      f.key !== 'background'
  );
}

/** The content fields that are a repeated-item array (`type: 'items'`). */
function collectionFields(def) {
  return contentFields(def).filter((f) => f.type === 'items');
}

/**
 * Types whose declaration does not yet match their schema, each with the reason
 * and what has to happen for the entry to go.
 *
 * This follows the pattern `eslint-suppressions.json` established: the gate is
 * on from day one for everything new, and the existing violations are an
 * explicit, shrinking list rather than a reason to weaken the rule. Every entry
 * here is a finding — recording what the facet exposed is the real measurement
 * of this brief, not a workaround.
 */
const BURNDOWN = {
  'image-text-slide':
    'Declared singleton, carries images[0-3]. The `duo` tile is a second ' +
    'contract under one type id, not a ninth layout: flipping back to `split` ' +
    'orphans images 2 and 3. Open question 5 in the umbrella brief — the cut ' +
    'is a product decision (image-text strictly one image, the plural cases to ' +
    'the image collection), not a relabelling.',
  'quote-slide':
    'Declared singleton, carries quotes[0-2] beside scalar quote/authorName/…. ' +
    'The same legacy-mirror disease as team-cards: one type, two ' +
    'representations. Resolve by retiring one side, not by calling it a ' +
    'collection.',
  'content-columns-slide':
    'Declared collection, has no items[] field at all — 130 numbered col{N}* ' +
    'scalars instead. Deprecated with `text-blocks-slide` as successor, so the ' +
    'entry dies with rung 3 rather than being fixed.',
  'poll-slide':
    'Declared fixed-collection, carries option1..option4 as scalars. Never got ' +
    'the items[] migration the other collections did.',
  'likert-slide':
    'Declared fixed-collection, carries option1..option10 as scalars. Same as ' +
    'poll-slide.',
};

// --- assertion 1: completeness --------------------------------------------

test('every core slide type declares a structure from the vocabulary', () => {
  const missing = [];
  for (const name of CORE_SLIDE_TYPE_NAMES) {
    const declared = SLIDE_TYPES[name]?.structure;
    if (!isSlideStructure(declared)) missing.push(`${name} (${declared ?? 'none'})`);
  }
  assert.deepEqual(
    missing,
    [],
    `every type must declare one of ${SLIDE_STRUCTURE_NAMES.join(', ')}:\n` +
      missing.join('\n')
  );
});

// --- assertion 2: truthfulness --------------------------------------------

test('the declared structure matches what the field schema actually says', () => {
  const lies = [];
  for (const name of CORE_SLIDE_TYPE_NAMES) {
    const def = SLIDE_TYPES[name];
    const structure = slideStructure(def);
    const collections = collectionFields(def);
    const n = collections.length;
    const keys = collections.map((f) => f.key).join(', ') || 'none';

    let problem = '';
    switch (structure) {
      case 'singleton':
        if (n !== 0) problem = `singleton must carry no items[] field, has ${n} (${keys})`;
        break;
      case 'collection':
        if (n !== 1) problem = `collection must carry exactly one items[] field, has ${n} (${keys})`;
        break;
      case 'fixed-collection': {
        if (n !== 1) {
          problem = `fixed-collection must carry exactly one items[] field, has ${n} (${keys})`;
        } else {
          const f = collections[0];
          if (!(Number(f.minItems) > 0 && Number(f.minItems) === Number(f.maxItems))) {
            problem =
              `fixed-collection means the count is part of the meaning, so ` +
              `${f.key} must pin minItems === maxItems (got ${f.minItems}..${f.maxItems})`;
          }
        }
        break;
      }
      case 'tabular':
        if (n !== 1) problem = `tabular must carry exactly one items[] field (the rows), has ${n} (${keys})`;
        break;
      case 'chrome': {
        const content = contentFields(def);
        if (content.length) {
          problem = `chrome carries no content at all, has ${content.length} (${content.map((f) => f.key).join(', ')})`;
        }
        break;
      }
      case 'dataset':
        // A dataset's payload is an encoded blob (chart-slide's CSV `data`),
        // not a field shape the registry can check. Nothing derivable to assert.
        break;
      default:
        problem = `unknown structure '${structure}'`;
    }
    if (problem) lies.push(`${name}: ${problem}`);
  }

  const unexpected = lies.filter((l) => !BURNDOWN[l.split(':')[0]]);
  assert.deepEqual(
    unexpected,
    [],
    `a type's declared structure contradicts its schema. Fix the schema or the ` +
      `declaration — do not add to BURNDOWN without a reason:\n${unexpected.join('\n')}`
  );

  // Reverse direction: a burndown entry that no longer fails is rot, the same
  // rule the companion matrix and the removal record already follow.
  const stillFailing = new Set(lies.map((l) => l.split(':')[0]));
  const stale = Object.keys(BURNDOWN).filter((n) => !stillFailing.has(n));
  assert.deepEqual(
    stale,
    [],
    `these types now match their declaration — drop them from BURNDOWN:\n${stale.join('\n')}`
  );
});

test('the burndown is a worklist, not a hiding place', () => {
  // Every entry names a type that exists and carries a reason long enough to be
  // one. Cheap, but it is what stopped the two hand-written picker tables from
  // being kept honest.
  for (const [name, reason] of Object.entries(BURNDOWN)) {
    assert.ok(SLIDE_TYPES[name], `burndown names a registered type: ${name}`);
    assert.ok(reason.length > 60, `burndown entry for ${name} needs a real reason`);
  }
});
