/**
 * The wire half of the aggregator-seam rule: `/api/slide-types` carries the
 * three authoring companions, and the inspector keep-list beside them.
 *
 * Why this file exists at all. Two of the three lookups — `schematicFor()` and
 * `getSampleContent()` — have always checked the definition before the per-type
 * map, precisely so a type in `custom/slide-types/` could ship a glyph or an
 * example without owning a directory in `shared/`. That branch was dead where it
 * mattered: the editor does not hold the registry, it holds this response, and
 * this response served neither key. A fork type could declare `sampleContent`
 * and no browser consumer would ever see it. The consumers were right; the wire
 * dropped the keys they read.
 *
 * `inspectorKeeps` is here for the same reason and needed no bug to prove it:
 * the keep-list lookup was core-map-only, so a fork type could not narrow its
 * own settings pane at all. It got the definition-first branch and the wire in
 * one go.
 *
 * So the checks below are about the *route*, not about any one type: that the
 * keys travel, that what travels is what the facet modules resolve, and that a
 * declaration on a non-core definition survives the trip.
 *
 * Run with: node --test tests/slide-type-api-companions.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { SLIDE_TYPE_AUTHORING } from '../shared/slide-types/authoring.js';
import { slideTypeGroup } from '../shared/slide-types/authoring-groups.js';
import {
  slideTypeAliases,
  slideTypeDescription,
  slideTypeSample,
  slideTypeSchematic,
} from '../shared/slide-types/authoring-companions.js';
import { slideTypeInspectorKeeps } from '../shared/slide-types/inline-edit-companions.js';
import { handleSlideTypes } from '../server/routes/api/slide-types.js';

/** Drive the route the way the server does and hand back the parsed body. */
async function fetchMeta() {
  let body = '';
  const res = {
    writeHead() {},
    end(chunk) {
      body = chunk;
    },
  };
  const handled = await handleSlideTypes({
    req: { method: 'GET' },
    res,
    url: new URL('http://localhost/api/slide-types'),
    authedUser: null,
  });
  assert.equal(handled, true, 'the route did not claim GET /api/slide-types');
  return JSON.parse(body);
}

const META = await fetchMeta();

describe('the companions travel', () => {
  it('every offerable type is served a group', () => {
    const missing = Object.keys(SLIDE_TYPES)
      .filter((name) => !SLIDE_TYPES[name]?.deprecated)
      .filter(
        (name) => slideTypeGroup(name, SLIDE_TYPES[name]) && !META[name]?.group,
      )
      .sort();
    assert.deepStrictEqual(
      missing,
      [],
      'a type resolves to a shelf on the server but the editor is not told which',
    );
    const served = Object.values(META).filter((m) => m.group).length;
    assert.ok(
      served > 30,
      `only ${served} types carry a group; the check would be vacuous`,
    );
  });

  it('what is served is what the facet modules resolve', () => {
    for (const [name, def] of Object.entries(SLIDE_TYPES)) {
      const m = META[name];
      assert.ok(m, `${name} is registered but absent from the response`);
      assert.equal(m.group ?? '', slideTypeGroup(name, def), `${name}: group`);
      assert.deepStrictEqual(
        m.schematic ?? null,
        slideTypeSchematic(name, def),
        `${name}: schematic`,
      );
      assert.deepStrictEqual(
        m.sampleContent,
        slideTypeSample(name, def),
        `${name}: sampleContent`,
      );
      assert.equal(
        m.description ?? '',
        slideTypeDescription(name, def),
        `${name}: description`,
      );
      assert.equal(
        m.aliases ?? '',
        slideTypeAliases(name, def),
        `${name}: aliases`,
      );
      assert.deepStrictEqual(
        m.inspectorKeeps ?? null,
        slideTypeInspectorKeeps(name, def),
        `${name}: inspectorKeeps`,
      );
    }
  });

  it('every registered type is served its keep-list', () => {
    // The one companion where an empty array is a real answer: `[]` means the
    // canvas covers the whole slide, absent means nobody narrowed the type and
    // the inspector falls back to everything. Serving `[]` for both would strip
    // the settings pane of every fork type.
    const missing = Object.keys(SLIDE_TYPES)
      .filter(
        (name) =>
          slideTypeInspectorKeeps(name, SLIDE_TYPES[name]) &&
          !META[name]?.inspectorKeeps,
      )
      .sort();
    assert.deepStrictEqual(
      missing,
      [],
      'a type has a keep-list the editor is not told',
    );
    const served = Object.values(META).filter((m) => m.inspectorKeeps).length;
    assert.ok(
      served > 30,
      `only ${served} types carry a keep-list; the check would be vacuous`,
    );
  });

  it('a deprecated type is served no shelf', () => {
    const stale = Object.entries(SLIDE_TYPES)
      .filter(([name, def]) => def?.deprecated && META[name]?.group)
      .map(([name]) => name)
      .sort();
    assert.deepStrictEqual(
      stale,
      [],
      'curation is about what an author may insert; a deprecated type is already ' +
        'unreachable from every insertion path',
    );
  });

  it('the companions survive the JSON trip intact', () => {
    // They are declared as plain data for exactly this reason. A function, a
    // Date or an undefined leaf would arrive at the editor changed or missing,
    // and the editor would fall back to core without anything saying so.
    for (const [name, m] of Object.entries(META)) {
      for (const key of [
        'group',
        'schematic',
        'sampleContent',
        'inspectorKeeps',
      ]) {
        if (m[key] === undefined) continue;
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(m[key])),
          m[key],
          `${name}: ${key} is not JSON-safe`,
        );
      }
    }
  });
});

describe('a non-core declaration reaches the editor', () => {
  // The registry may or may not hold a fork type in this checkout
  // (custom/slide-types/ is gitignored), so the seam is exercised through the
  // facet modules with a stand-in definition rather than through the route.
  // What the route contributes — that it asks the facet modules at all — is
  // pinned by the equality check above.
  const forkDef = {
    label: 'Hero',
    group: 'media',
    schematic: { kind: 'image' },
    sampleContent: { title: 'Welcome' },
    description: 'A big hero header',
    aliases: 'banner splash hero',
    inspectorKeeps: ['overlay'],
  };

  it('its group, glyph, example and keep-list all resolve from the definition', () => {
    assert.equal(slideTypeGroup('acme-hero', forkDef), 'media');
    assert.deepStrictEqual(slideTypeSchematic('acme-hero', forkDef), {
      kind: 'image',
    });
    assert.deepStrictEqual(slideTypeSample('acme-hero', forkDef), {
      title: 'Welcome',
    });
    assert.equal(
      slideTypeDescription('acme-hero', forkDef),
      'A big hero header',
    );
    assert.equal(slideTypeAliases('acme-hero', forkDef), 'banner splash hero');
    assert.deepStrictEqual(slideTypeInspectorKeeps('acme-hero', forkDef), [
      'overlay',
    ]);
  });

  it("and each degrades to nothing rather than to a core type's answer", () => {
    assert.equal(slideTypeGroup('acme-hero', { label: 'Hero' }), '');
    assert.equal(slideTypeSchematic('acme-hero', { label: 'Hero' }), null);
    assert.equal(slideTypeSample('acme-hero', { label: 'Hero' }), undefined);
    assert.equal(slideTypeDescription('acme-hero', { label: 'Hero' }), '');
    assert.equal(slideTypeAliases('acme-hero', { label: 'Hero' }), '');
    assert.equal(slideTypeInspectorKeeps('acme-hero', { label: 'Hero' }), null);
  });

  it('an empty keep-list is an answer, not an absence', () => {
    // `[]` says "the canvas covers all of it"; null says "nobody narrowed this".
    // The inspector's fallback branches on exactly that difference.
    assert.deepStrictEqual(
      slideTypeInspectorKeeps('acme-hero', { inspectorKeeps: [] }),
      [],
    );
    assert.equal(
      slideTypeInspectorKeeps('acme-hero', { inspectorKeeps: 'layout' }),
      null,
    );
    assert.equal(
      slideTypeInspectorKeeps('acme-hero', { inspectorKeeps: [1, 2] }),
      null,
    );
  });

  it('a definition may override core per companion, without touching the others', () => {
    const overridden = {
      ...SLIDE_TYPES['quote-slide'],
      schematic: { kind: 'image' },
    };
    assert.deepStrictEqual(slideTypeSchematic('quote-slide', overridden), {
      kind: 'image',
    });
    assert.equal(
      slideTypeGroup('quote-slide', overridden),
      slideTypeGroup('quote-slide'),
    );
    assert.deepStrictEqual(
      slideTypeSample('quote-slide', overridden),
      slideTypeSample('quote-slide'),
    );
  });
});

describe('the preset override still outranks the definition', () => {
  // Precedence is preset > definition > core. The preset tile is a *variant* of
  // the type, so a definition-level glyph — which describes the type — must not
  // replace the glyph for the tile someone is actually looking at.
  const [type, presetId] = firstPresetOverride();

  it('the fixture is real', () => {
    assert.ok(
      presetId,
      'no type declares a presetSchematics entry; the check is vacuous',
    );
  });

  it('a preset tile keeps its own glyph even when the definition has one', () => {
    const preset = slideTypeSchematic(type, null, presetId);
    const withDefGlyph = slideTypeSchematic(
      type,
      { schematic: { kind: 'image' } },
      presetId,
    );
    assert.deepStrictEqual(withDefGlyph, preset);
    // …and without a preset id, the definition wins as usual.
    assert.deepStrictEqual(
      slideTypeSchematic(type, { schematic: { kind: 'image' } }),
      {
        kind: 'image',
      },
    );
  });
});

/** The first `[type, presetId]` pair a core type declares a glyph override for. */
function firstPresetOverride() {
  for (const [name, authoring] of Object.entries(SLIDE_TYPE_AUTHORING)) {
    const presets = Object.keys(authoring?.presetSchematics || {});
    if (presets.length) return [name, presets[0]];
  }
  return [null, null];
}
