/**
 * The reader form of every core slide type, pinned as a fixture (B248).
 *
 * `itemLabelField` is declared on 1 of 34 types and `mediaRef` on 1, which is
 * exactly what D81/D82 intend — a type declares only where the "first readable
 * string" default would be wrong. What nothing pinned is the other side of that
 * bargain: **that the default is right for the other 33.** The projection is
 * derived from `fields[]`, so a field added, renamed or re-typed silently moves
 * what the reader calls the heading of a slide, and a wrong heading becomes a
 * wrong title box the moment the PPTX mapper reads the same projection.
 *
 * So this walks the whole core registry and stores what the reader actually
 * produces. A change here is not a failure — it is a diff to look at, and to
 * accept deliberately:
 *
 *     UPDATE_SNAPSHOT=1 node --test tests/semantic-projection-snapshot.test.js
 *
 * The fixture is also the artifact for the A2.5 gate ("does the text version of
 * each type read the way you would read it?"): one file, 34 types, both deck
 * languages, in the reader's own words rather than a summary of them.
 *
 * ## What it projects, and why through these seams
 *
 * - **`CORE_SLIDE_TYPE_DEFS`, not `SLIDE_TYPES`.** The fixture is a tracked
 *   artifact, so it must not shift by checkout: a fork that overrides a core
 *   name (this repo's own `custom/` carries one) would otherwise rewrite the
 *   committed output. Same line the generated schema docs and i18n extraction
 *   draw.
 * - **Through `newSlide()`**, the one factory a slide comes into being through
 *   (B243), with the type's own `sample` as the caller's patch — so the fixture
 *   shows the *filled-in* example the picker promises, over per-language
 *   defaults (`defaultsByLang`, declared by 27 of 34 types). No theme is passed:
 *   a theme only moves `background`, which is presentational and never
 *   projected, and leaving it out keeps the artifact deterministic.
 * - **Through `slideHeading()` + `renderSlideBodySemanticHtml()`**, which is the
 *   pair `server/export/reader.js` calls per slide. Projecting through anything
 *   else would pin a second reader that could drift from the one we ship.
 * - **With the sanitizer initialised**, as the server has it: without it
 *   markdown fields come out escaped, and the fixture would pin a form no
 *   reader ever serves.
 *
 * ## One entry that reads like a hole and is not
 *
 * `video-slide` — the one type that declares `mediaRef` — projects to an empty
 * body here, because its sample sets `source: ''` and so has no reference to
 * stand in for. That blank looks deliberate (a picker tile with a real source
 * embeds a live third-party player, the concern that exempts `embed-slide` from
 * having a sample at all) but nothing says so, so it is left exactly as it is
 * and the question is Jaap's, not this test's. The D82 stand-in itself is
 * proven against the type's *defaults* in `tests/semantic-projection.test.js`
 * ("video-slide projects its default Bunny UUID as heading + stand-in").
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real (non-escaping) sanitizer, so markdown projects to tags as it does in the
// server that serves the reader.
import { initSanitizer } from '../shared/sanitize.js';
await initSanitizer();

const { CORE_SLIDE_TYPE_DEFS, CORE_SLIDE_TYPE_NAMES, GLOBAL_SLIDE_FIELD_KEYS } =
  await import('../shared/slide-types/registry.js');
const { slideTypeSample } =
  await import('../shared/slide-types/authoring-companions.js');
const { slideHeading, renderSlideBodySemanticHtml } =
  await import('../shared/slide-types/semantic-projection.js');
const { newSlide } = await import('../shared/slide-types/presentation.js');

/** Both deck languages the types declare defaults for (`defaultsByLang`). */
const LANGS = ['nl', 'en-GB'];

const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'semantic-projection.json',
);

/**
 * The reader's view of one type in one deck language.
 *
 * @param {string} type - core slide type name
 * @param {string} lang - deck language
 * @returns {{heading: {text: string, key: string|null}, body: string}}
 */
function project(type, lang) {
  const def = CORE_SLIDE_TYPE_DEFS[type];
  const slide = newSlide({
    type,
    lang,
    content: slideTypeSample(type, def) || null,
    slideTypes: CORE_SLIDE_TYPE_DEFS,
    // Fixed, so an instance key (`presentationId`) cannot make the artifact
    // depend on which deck the projection ran for.
    presentationId: 'fixture-deck',
  });
  const heading = slideHeading(slide, def, 0);
  return {
    heading,
    body: renderSlideBodySemanticHtml(slide, def, {
      headingKey: heading.key,
      headingText: heading.text,
    }),
  };
}

/** The whole registry projected, in registration order. */
function projectAll() {
  const out = {};
  for (const type of CORE_SLIDE_TYPE_NAMES) {
    out[type] = {};
    for (const lang of LANGS) out[type][lang] = project(type, lang);
  }
  return out;
}

const actual = projectAll();

if (process.env.UPDATE_SNAPSHOT) {
  fs.writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`);
}

const expected = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

test('the fixture covers exactly the core registry', () => {
  assert.deepEqual(
    Object.keys(expected),
    CORE_SLIDE_TYPE_NAMES,
    'a type was added, removed or reordered without regenerating the fixture — ' +
      'run UPDATE_SNAPSHOT=1 node --test tests/semantic-projection-snapshot.test.js',
  );
});

for (const type of CORE_SLIDE_TYPE_NAMES) {
  test(`${type} projects to the pinned reader form`, () => {
    assert.deepEqual(
      actual[type],
      expected[type],
      `the reader form of ${type} changed. If that is the intent, accept it ` +
        'deliberately: UPDATE_SNAPSHOT=1 node --test ' +
        'tests/semantic-projection-snapshot.test.js',
    );
  });
}

/**
 * A sample that names a key the type does not declare is invisible: the
 * projection walks `fields[]`, the editor form does too, and the value is
 * dropped by the import funnel. So it never fails — the picker just quietly
 * previews the *defaults* where it promises an example, and the fixture above
 * would pin that lie as if it were the type's own sample.
 *
 * Measured at B248: four samples did exactly that. `kpi-metrics-slide` still
 * spoke the flat `metric1Value` model from before `metrics` became an items
 * field; `likert-slider-slide` still said `statement`/`labelLow`/`labelHigh`
 * where the fields are `question`/`minLabel`/`maxLabel`; and the two chrome
 * types carried samples for content they deliberately do not have. Fixing the
 * four without this guard would only reset the clock.
 */
test('every sample names only keys the type declares', () => {
  const globals = new Set(GLOBAL_SLIDE_FIELD_KEYS);
  const offenders = [];
  for (const type of CORE_SLIDE_TYPE_NAMES) {
    const def = CORE_SLIDE_TYPE_DEFS[type];
    const sample = slideTypeSample(type, def);
    if (!sample) continue;
    const declared = new Set([
      ...(def.fields || []).map((f) => f?.key),
      ...globals,
      // Instance keys are content the factory writes, not authored fields, so
      // a sample may name one (poll-slide's `pollId`).
      ...Object.keys(def.instanceKeys || {}),
    ]);
    const unknown = Object.keys(sample).filter((k) => !declared.has(k));
    if (unknown.length) offenders.push(`${type}: ${unknown.join(', ')}`);
  }
  assert.deepEqual(
    offenders,
    [],
    'these samples name keys no field, global or instance key declares, so ' +
      `the picker previews defaults where it promises an example:\n${offenders.join('\n')}`,
  );
});
