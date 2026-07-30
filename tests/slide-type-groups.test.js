/**
 * The `group` axis — the guardrail, and an honest note about its ceiling.
 *
 * The picker's shelves and the settings curation headings used to be two
 * hand-written membership tables that disagreed about five of the 33 offerable
 * types, and both folded an unknown type into "Other" without complaining. One
 * declaration on the type now feeds both.
 *
 * What can be asserted: every offerable type declares a group from the
 * vocabulary, a deprecated type declares none, and no consumer keeps a
 * competing membership list. What cannot: whether the declaration is *right*.
 * Unlike `structure` (checkable against the field schema) and `runtime`
 * (checkable against the modules that consume it), this axis is a judgement
 * call, so there is no truthfulness assertion here and there cannot be one.
 *
 * @see shared/slide-types/authoring-groups.js
 * @see docs/reference/slide-type-groups.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SLIDE_TYPES, CUSTOM_SLIDE_TYPE_NAMES } from '../shared/slide-types/registry.js';
import { SLIDE_TYPE_AUTHORING } from '../shared/slide-types/authoring.js';
import {
  SLIDE_TYPE_GROUPS,
  SLIDE_TYPE_GROUP,
  isSlideTypeGroup,
  typesInGroup,
} from '../shared/slide-types/authoring-groups.js';
import {
  PICKER_GROUP_ORDER,
  PICKER_GROUP_KEYS,
} from '../client/views/editor/slide-type-picker/data.js';
import {
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  getCategories,
} from '../client/views/settings/tabs/slide-types-tab/categories.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Core types an author can still be offered — the ones that owe a group. */
const OFFERABLE = Object.entries(SLIDE_TYPES)
  .filter(([name, def]) => !CUSTOM_SLIDE_TYPE_NAMES.includes(name) && !def?.deprecated)
  .map(([name]) => name);

/** Core types past the deprecation gate — the ones that must declare none. */
const DEPRECATED = Object.entries(SLIDE_TYPES)
  .filter(([name, def]) => !CUSTOM_SLIDE_TYPE_NAMES.includes(name) && def?.deprecated)
  .map(([name]) => name);

describe('the group axis', () => {
  it('every offerable core type declares a group from the vocabulary', () => {
    const undeclared = OFFERABLE.filter((name) => !SLIDE_TYPE_GROUP[name]).sort();
    assert.deepStrictEqual(
      undeclared,
      [],
      'a type without a group is not visibly broken — it just quietly lands in ' +
        '"Other" on both surfaces, which is exactly how the old drift hid. ' +
        'Declare `group` in shared/slide-types/types/<name>/authoring.js.'
    );
    assert.ok(OFFERABLE.length > 30, 'the offerable set looks wrong; the check would be vacuous');
  });

  it('no type declares a group outside the vocabulary', () => {
    const bogus = Object.entries(SLIDE_TYPE_AUTHORING)
      .filter(([, a]) => a?.group !== undefined && !isSlideTypeGroup(a.group))
      .map(([name, a]) => `${name}: ${JSON.stringify(a.group)}`)
      .sort();
    assert.deepStrictEqual(bogus, [], `known groups: ${Object.keys(SLIDE_TYPE_GROUPS).join(', ')}`);
  });

  it('a deprecated type declares no group', () => {
    const stale = DEPRECATED.filter((name) => SLIDE_TYPE_GROUP[name]).sort();
    assert.deepStrictEqual(
      stale,
      [],
      'curation is about what an author may insert, so a deprecated type has ' +
        'nothing to be on a shelf for (see isInsertableSlideType).'
    );
  });

  it('every group in the vocabulary is used, and every shelf is non-empty', () => {
    for (const group of Object.keys(SLIDE_TYPE_GROUPS)) {
      assert.ok(
        typesInGroup(group).length > 0,
        `no type declares "${group}" — an unused shelf is vocabulary nobody asked for`
      );
    }
  });

  it('a type is on exactly one shelf', () => {
    const seen = new Map();
    for (const group of Object.keys(SLIDE_TYPE_GROUPS)) {
      for (const type of typesInGroup(group)) {
        assert.ok(!seen.has(type), `${type} is on both ${seen.get(type)} and ${group}`);
        seen.set(type, group);
      }
    }
  });
});

describe('the consumers derive rather than restate', () => {
  it('the picker renders every declared shelf but "other"', () => {
    // "Other" is computed at render time from everything uncurated, so a type
    // declaring `other` lands there without the picker naming a shelf for it.
    const rendered = [...PICKER_GROUP_KEYS].sort();
    const declared = Object.keys(SLIDE_TYPE_GROUPS)
      .filter((g) => g !== 'other')
      .sort();
    assert.deepStrictEqual(rendered, declared);
  });

  it('the settings tab renders every declared shelf', () => {
    assert.deepStrictEqual(
      CATEGORY_ORDER.map((c) => c.key).sort(),
      Object.keys(SLIDE_TYPE_GROUPS).sort()
    );
    for (const { key } of CATEGORY_ORDER) {
      assert.equal(typeof CATEGORY_LABELS[key], 'function', `no label for ${key}`);
    }
  });

  it('both surfaces agree, because they read the same declarations', () => {
    const settings = Object.fromEntries(getCategories().map((c) => [c.key, c.types]));
    for (const key of PICKER_GROUP_KEYS) {
      assert.deepStrictEqual(
        typesInGroup(key, PICKER_GROUP_ORDER[key]).slice().sort(),
        settings[key].slice().sort(),
        `${key} differs between the picker and the settings tab — impossible ` +
          'unless one of them grew its own membership again'
      );
    }
  });

  it('the order hints only reorder: they never add or remove a type', () => {
    const hints = [
      ...Object.entries(PICKER_GROUP_ORDER),
      ...CATEGORY_ORDER.map((c) => [c.key, c.types]),
    ];
    for (const [group, order] of hints) {
      const members = typesInGroup(group);
      assert.deepStrictEqual(
        typesInGroup(group, order).slice().sort(),
        members.slice().sort(),
        `the hint for "${group}" changed the membership`
      );
      const strays = order.filter((type) => !members.includes(type));
      assert.deepStrictEqual(
        strays,
        [],
        `the "${group}" order hint names ${strays.join(', ')}, which no longer ` +
          'declares that group. Harmless at runtime (it is ignored), but stale.'
      );
    }
  });
});

describe('the ceiling: nothing re-derives the grouping by hand', () => {
  // The floor above says every type declares. This is the other direction, and
  // it is the whole guardrail on an axis no test can check for truthfulness: if
  // a module grows its own list of "the media types", the declaration has
  // stopped being the single authority even while every assertion above passes.
  // Same shape as the ceiling `runtime` replaced its floor assertion with.
  const GROUPED = Object.entries(SLIDE_TYPE_GROUP).reduce((acc, [type, group]) => {
    (acc[group] ||= []).push(type);
    return acc;
  }, {});

  /** Files a module may legitimately hold a shelf-shaped list in. */
  const ALLOWED = new Set([
    'shared/slide-types/authoring-groups.js',
    'client/views/editor/slide-type-picker/data.js',
    'client/views/settings/tabs/slide-types-tab/categories.js',
    'tests/slide-type-groups.test.js',
  ]);

  const sources = () => {
    const out = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) { walk(abs); continue; }
        if (!entry.name.endsWith('.js')) continue;
        out.push(abs);
      }
    };
    for (const dir of ['client', 'server', 'shared', 'scripts']) walk(path.join(repoRoot, dir));
    return out;
  };

  const ALL_TYPES = Object.keys(SLIDE_TYPES);

  it('no module outside the declaration and its two consumers holds a shelf', () => {
    // The rule, stated so its limits are visible rather than implied: a module
    // offends when the type names it mentions are *exactly* one shelf — every
    // member, and nothing else. That is unambiguously a hand-derived shelf.
    //
    // What it deliberately does not catch, so nobody reads a green run as more
    // than it is: a module that holds a shelf *and* mentions other types
    // elsewhere in the same file (the granularity here is the file, not the
    // declaration). Looser rules were measured first and are unusable — an
    // exhaustive per-type table like INSPECTOR_KEEPS contains every shelf by
    // construction, and `basic` is five very common types that any module
    // touching titles and body copy collides with. A gate with false positives
    // gets suppressed, and a suppressed gate guards nothing.
    const offenders = [];
    for (const abs of sources()) {
      const rel = path.relative(repoRoot, abs);
      if (ALLOWED.has(rel)) continue;
      const src = fs.readFileSync(abs, 'utf8');
      const named = ALL_TYPES.filter(
        (type) => src.includes(`'${type}'`) || src.includes(`"${type}"`)
      );
      if (named.length < 3) continue;
      for (const [group, types] of Object.entries(GROUPED)) {
        if (types.length < 3) continue;
        const isExactly =
          types.every((type) => named.includes(type)) &&
          named.every((type) => types.includes(type));
        if (isExactly) offenders.push(`${rel} is exactly the "${group}" shelf`);
      }
    }
    assert.deepStrictEqual(
      offenders,
      [],
      'a module whose type vocabulary is exactly one shelf has re-derived the ' +
        'grouping by hand. Read it from SLIDE_TYPE_GROUP / typesInGroup().'
    );
  });
});
