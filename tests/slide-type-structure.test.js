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
import { getLayoutVariants } from '../shared/slide-types/layout-variants.js';

/**
 * The `structure` facet's guardrail — assertions 1 to 4 of brief B.
 *
 * The point of starting with `structure` rather than `intent` is that it is
 * *derivable*: the declaration says what shape the content has, and the field
 * schema already knows. So a lie is detectable, and these tests are what make
 * the declaration worth more than a comment.
 *
 * Assertion 5 (the companion matrix has no hole) is a separate change: it is
 * about the hand-maintained companions rather than the facet, and it belongs
 * next to the matrix it guards.
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

// --- assertion 3: no duplicates -------------------------------------------

/**
 * A type's **field signature**: every content field as `key:type`, sorted, with
 * a repeated-item field carrying its item shape. Two types with the same
 * signature offer the author the same slots under two names.
 *
 * Deliberately coarse — `key:type` and not the enum options or the length
 * limits. A coarse signature collides more easily, which is what a gate wants:
 * two types that differ only in one enum value are a duplicate worth hearing
 * about, and the answer can still be "they are genuinely different, here is why"
 * in the burndown.
 */
function fieldSignature(def) {
  return contentFields(def)
    .map((f) => {
      if (f.type !== 'items' || !Array.isArray(f.itemFields)) return `${f.key}:${f.type}`;
      const shape = f.itemFields
        .filter((i) => i && typeof i.key === 'string')
        .map((i) => `${i.key}:${i.type}`)
        .sort()
        .join(',');
      return `${f.key}:items{${shape}}`;
    })
    .sort()
    .join('|');
}

/**
 * Pairs that share a signature today, each with what has to happen for the
 * entry to go. Same discipline as the structure burndown above.
 */
const SIGNATURE_BURNDOWN = {
  'lijstje-slide == list-slide':
    'One definition behind two names: lijstje-slide is `{ ...listSlide, ai: ' +
    'false }`. This is the pair the assertion exists for — it stood beside ' +
    'itself in the picker for months, twice labelled "List". Already on rung 1 ' +
    'of the removal ladder; the entry dies with rung 3 (brief A step 4).',
};

test('no two slide types offer the same field signature', () => {
  const bySignature = new Map();
  for (const name of CORE_SLIDE_TYPE_NAMES) {
    const def = SLIDE_TYPES[name];
    // `chrome` means "carries no content fields at all", so every chrome type
    // has the empty signature by construction. Colliding there says nothing
    // about duplication — payoff and follow-invite differ in what they pull
    // from the theme, not in what the author fills in. This is the facet
    // earning its keep inside the test that needs it.
    if (slideStructure(def) === 'chrome') continue;
    const sig = fieldSignature(def);
    if (!bySignature.has(sig)) bySignature.set(sig, []);
    bySignature.get(sig).push(name);
  }

  const clashes = [...bySignature.values()]
    .filter((names) => names.length > 1)
    .map((names) => [...names].sort().join(' == '))
    .sort();

  const unexpected = clashes.filter((c) => !SIGNATURE_BURNDOWN[c]);
  assert.deepEqual(
    unexpected,
    [],
    `these types offer the author the same slots under different names. Either ` +
      `they are one type, or one of them owes a field that makes it a different ` +
      `contract:\n${unexpected.join('\n')}`
  );

  const stale = Object.keys(SIGNATURE_BURNDOWN).filter((c) => !clashes.includes(c));
  assert.deepEqual(
    stale,
    [],
    `these pairs no longer share a signature — drop them from ` +
      `SIGNATURE_BURNDOWN:\n${stale.join('\n')}`
  );

  // A signature map that collapsed to nothing would pass vacuously.
  assert.ok(
    bySignature.size > 30,
    `expected a signature per non-chrome type, got ${bySignature.size}`
  );
});

// --- assertion 4: variants are lossless ------------------------------------

/**
 * A sentinel value for one field, unique per field path and safe through HTML
 * escaping (letters and underscores only, so nothing in the render pipeline
 * rewrites it).
 */
const sentinel = (path) => `ZZ${path.replace(/[^a-zA-Z0-9]/g, '_')}ZZ`;

/** A representative value for a field, carrying a sentinel where it can. */
function sampleValue(field, path) {
  switch (field.type) {
    case 'items': {
      const max = Number(field.maxItems) || 3;
      const count = Math.min(Math.max(Number(field.minItems) || 0, 3), max);
      return Array.from({ length: count }, (_, i) =>
        Object.fromEntries(
          (field.itemFields || [])
            .filter((f) => f && typeof f.key === 'string')
            .map((f) => [f.key, sampleValue(f, `${path}_${i}_${f.key}`)])
        )
      );
    }
    case 'number':
      return 50;
    case 'boolean':
      return true;
    case 'enum': {
      const first = field.options?.[0];
      return typeof first === 'string' ? first : (first?.value ?? '');
    }
    case 'image':
      return `/uploads/${sentinel(path)}.png`;
    default:
      return sentinel(path);
  }
}

/** Every sentinel a fully-populated instance of this type carries, by label. */
function sentinelsFor(def) {
  const out = [];
  const walk = (field, path, value) => {
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        for (const [k, v] of Object.entries(item)) {
          if (typeof v === 'string' && v.includes('ZZ')) {
            out.push({ label: `${field.key}[${i}].${k}`, sentinel: sentinel(`${path}_${i}_${k}`) });
          }
        }
      });
      return;
    }
    if (typeof value === 'string' && value.includes('ZZ')) {
      out.push({ label: field.key, sentinel: sentinel(path) });
    }
  };
  for (const f of contentFields(def)) walk(f, f.key, sampleValue(f, f.key));
  return out;
}

/**
 * Types whose layout variants are not interchangeable, with what has to happen
 * for the entry to go.
 */
const VARIANT_BURNDOWN = {
  'image-text-slide':
    'The layout tiles disagree about how many images they render: `split`, ' +
    '`corner` show one cell, `duo` two, the rows up to three. Flipping duo -> ' +
    'split orphans image 2 — the boundary the rule names, and the same finding ' +
    'the structure burndown records from the schema side. The cut (image-text ' +
    'strictly one image, the plural cases to the image collection) is a product ' +
    'decision, open question 5 in the umbrella brief.',
};

test('every layout variant of a type carries the same content', () => {
  // The rule, made operational: a variant is a render choice every valid
  // instance survives without loss. So populate the type completely, flip to
  // each variant, and see which values still reach the rendered slide. A value
  // that disappears under one tile and not another is content the author loses
  // by switching — which makes it a type boundary, not a variant.
  //
  // Variants with `convertTo` are cross-type exits through the convert seam
  // (image-text's "Text only" hands off to content-slide). Those are a boundary
  // already modelled correctly; only same-type tiles are in scope here.
  const lossy = [];
  let checked = 0;

  for (const name of CORE_SLIDE_TYPE_NAMES) {
    const def = SLIDE_TYPES[name];
    if (typeof def?.renderHtml !== 'function') continue;
    const variants = getLayoutVariants(def).filter((v) => v && !v.convertTo && v.set);
    if (variants.length < 2) continue;

    const base = Object.fromEntries(
      contentFields(def).map((f) => [f.key, sampleValue(f, f.key)])
    );
    const probes = sentinelsFor(def);
    assert.ok(probes.length, `${name}: no content to probe — the sample is empty`);

    const carried = new Map();
    for (const variant of variants) {
      const content = { ...base, ...variant.set };
      const html = def.renderHtml(content, { id: 's1', type: name }, {}) || '';
      carried.set(
        variant.id,
        new Set(probes.filter((p) => html.includes(p.sentinel)).map((p) => p.label))
      );
    }

    const union = new Set([...carried.values()].flatMap((s) => [...s]));
    assert.ok(union.size, `${name}: no variant rendered any content — the probe is broken`);
    checked += 1;

    for (const [id, keys] of carried) {
      const missing = [...union].filter((k) => !keys.has(k)).sort();
      if (missing.length) {
        lossy.push(`${name}: variant '${id}' drops ${missing.join(', ')}`);
      }
    }
  }

  assert.ok(checked > 5, `expected several types with layout variants, checked ${checked}`);

  const unexpected = lossy.filter((l) => !VARIANT_BURNDOWN[l.split(':')[0]]);
  assert.deepEqual(
    unexpected,
    [],
    `a layout variant throws content away, so it is a second contract under one ` +
      `type id rather than a render choice:\n${unexpected.join('\n')}`
  );

  const stillFailing = new Set(lossy.map((l) => l.split(':')[0]));
  const stale = Object.keys(VARIANT_BURNDOWN).filter((n) => !stillFailing.has(n));
  assert.deepEqual(
    stale,
    [],
    `these types' variants are interchangeable now — drop them from ` +
      `VARIANT_BURNDOWN:\n${stale.join('\n')}`
  );
});

// --- the burndowns themselves ---------------------------------------------

test('the burndowns are worklists, not hiding places', () => {
  // Every entry names something that exists and carries a reason long enough to
  // be one. Cheap, but it is what stopped the two hand-written picker tables
  // from being kept honest.
  for (const [name, reason] of Object.entries(BURNDOWN)) {
    assert.ok(SLIDE_TYPES[name], `burndown names a registered type: ${name}`);
    assert.ok(reason.length > 60, `burndown entry for ${name} needs a real reason`);
  }
  for (const [name, reason] of Object.entries(VARIANT_BURNDOWN)) {
    assert.ok(SLIDE_TYPES[name], `variant burndown names a registered type: ${name}`);
    assert.ok(reason.length > 60, `variant burndown entry for ${name} needs a real reason`);
  }
  for (const [pair, reason] of Object.entries(SIGNATURE_BURNDOWN)) {
    for (const name of pair.split(' == ')) {
      assert.ok(SLIDE_TYPES[name], `signature burndown names a registered type: ${name}`);
    }
    assert.ok(reason.length > 60, `signature burndown entry for ${pair} needs a real reason`);
  }
});
