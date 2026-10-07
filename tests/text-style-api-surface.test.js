/**
 * The published surfaces state the text-style offer the write path enforces
 * (B464 PR 3): the per-type JSON Schema, the agent catalog behind MCP
 * `get_slide_types`, the strict content check of
 * `create_presentation_from_slides`, and `docs/openapi.yaml`. Each is read off
 * `textStyleOffers()` / `acceptedTextStyles()` / `TEXT_STYLE_REFUSAL_REASONS`,
 * so a new offer or a new refusal reaches every surface or fails here.
 *
 * Run with: node --test tests/text-style-api-surface.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import {
  SLIDE_TYPES,
  CUSTOM_SLIDE_TYPE_NAMES,
} from '../shared/slide-types/registry.js';
import { slideTypeContentSchema } from '../shared/slide-types/json-schema.js';
import {
  TEXT_ALIGN_VALUES,
  TEXT_SIZE_VALUES,
  TEXT_STYLE_REFUSAL_REASONS,
  acceptedTextStyles,
  textStyleOffers,
  textStyleRefusals,
} from '../shared/slide-types/text-styles.js';
import { resolveAgentSlideTypes } from '../server/utils/ai/slide-catalog/agent-catalog.js';
import { validateSlideContent } from '../server/utils/ai/schemas/content-schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const openapi = parseYaml(
  fs.readFileSync(path.join(here, '..', 'docs', 'openapi.yaml'), 'utf8'),
);

const CORE_ENTRIES = Object.entries(SLIDE_TYPES).filter(
  ([name]) => !CUSTOM_SLIDE_TYPE_NAMES.includes(name),
);

test('the JSON Schema publishes exactly the offers, with the accepted values', () => {
  let offering = 0;
  for (const [name, def] of CORE_ENTRIES) {
    const published = slideTypeContentSchema(name, def).properties.textStyles;
    const offers = [...textStyleOffers(def).keys()];
    if (!offers.length) {
      assert.equal(published, undefined, `${name} offers nothing`);
      continue;
    }
    offering += 1;
    assert.equal(published.additionalProperties, false, name);
    assert.deepEqual(Object.keys(published.properties), offers, name);
    for (const [key, values] of Object.entries(acceptedTextStyles(def))) {
      const entry = published.properties[key];
      assert.equal(entry.additionalProperties, false, `${name} ${key}`);
      assert.deepEqual(
        Object.fromEntries(
          Object.entries(entry.properties).map(([p, s]) => [p, s.enum]),
        ),
        values,
        `${name} ${key}`,
      );
    }
  }
  assert.ok(offering > 0, 'some core type offers text styling');
});

test('the agent catalog lists the same offers, and nothing for a type without one', () => {
  const types = resolveAgentSlideTypes({ lang: 'en-GB' });
  for (const [name, entry] of Object.entries(types)) {
    const accepted = acceptedTextStyles(SLIDE_TYPES[name]);
    if (!Object.keys(accepted).length) {
      assert.equal('textStyles' in entry, false, name);
    } else {
      assert.deepEqual(entry.textStyles, accepted, name);
    }
  }
});

test('every value the catalog lists passes the write path', () => {
  for (const [name, def] of CORE_ENTRIES) {
    for (const [key, values] of Object.entries(acceptedTextStyles(def))) {
      for (const [prop, list] of Object.entries(values)) {
        for (const value of list) {
          assert.deepEqual(
            textStyleRefusals({ [key]: { [prop]: value } }, def),
            [],
            `${name} ${key}.${prop}=${value}`,
          );
        }
      }
    }
  }
});

test('strict validation knows textStyles exactly where a type offers it', () => {
  const content = SLIDE_TYPES['content-slide'];
  assert.equal(
    validateSlideContent(content, {
      title: 'T',
      body: 'B',
      textStyles: { body: { size: 'lg' } },
    }).valid,
    true,
  );
  const team = SLIDE_TYPES['team-cards-slide'];
  assert.equal(textStyleOffers(team).size, 0);
  const result = validateSlideContent(team, {
    members: [],
    textStyles: { 'members.*.name': { size: 'lg' } },
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((i) => i.code === 'unrecognized_keys'));
});

test('the reason register is what the refusals produce', () => {
  const def = SLIDE_TYPES['quote-slide'];
  const reasons = new Set(
    [
      'not a map',
      { 'quotes.*.quote': 'lg' },
      { 'quotes.1.quote': { size: 'lg' } },
      { body: { size: 'lg' } },
      { 'quotes.*.quote': { color: 'red' } },
      { 'quotes.*.quote': { size: 'xl' } },
    ].flatMap((raw) => textStyleRefusals(raw, def).map((r) => r.reason)),
  );
  assert.deepEqual([...reasons].sort(), [...TEXT_STYLE_REFUSAL_REASONS].sort());
});

test('openapi.yaml documents the server refusals and the vocabulary', () => {
  const refusal = openapi.components.schemas.TextStyleRefusal;
  assert.deepEqual(refusal.properties.reason.enum, [
    ...TEXT_STYLE_REFUSAL_REASONS,
  ]);
  for (const reason of TEXT_STYLE_REFUSAL_REASONS) {
    assert.match(refusal.description, new RegExp(`\`${reason}\``), reason);
  }
  const entry =
    openapi.components.schemas.Slide.properties.content.properties.textStyles
      .additionalProperties;
  assert.deepEqual(entry.properties.align.enum, TEXT_ALIGN_VALUES);
  assert.deepEqual(entry.properties.size.enum, TEXT_SIZE_VALUES);
  assert.equal(entry.additionalProperties, false);
});
