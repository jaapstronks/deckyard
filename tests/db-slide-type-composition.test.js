/**
 * B240: a database-backed slide type is composed like every other registry
 * entry.
 *
 * `composeSlideType` appends the global slide fields (background, a11y, theme
 * logo) and the i18n key annotations to a type's own schema. The registry runs
 * it on core and file-JS types at boot; `toRuntimeSlideType` did not run it at
 * all, so an organization's DB type reached the inspector without those fields.
 *
 * The difference never showed in the render — `renderSlideHtml` injects the
 * background and logo layers from the slide's content whatever the schema says
 * — which is exactly why it could sit there: the slide looked right, and the
 * editor simply offered no way to set any of it.
 *
 * These pin the composition and its consequence for the DB field rules: a
 * stored `fields[]` is RAW, so `DB_TYPE_PROFILE` must name the injected keys —
 * a `mediaRef.linkKey` may point at one of them.
 *
 * Run with: node --test tests/db-slide-type-composition.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { toRuntimeSlideType } from '../server/utils/custom-slide-type-runtime.js';
import { customSlideTypeKey } from '../shared/slide-types/custom-type-runtime.js';
import { GLOBAL_SLIDE_FIELD_KEYS } from '../shared/slide-types/compose.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { validateCustomFieldDefinitions } from '../shared/slide-types/custom-field-definitions.js';
import { walkFieldDefinitions } from '../shared/slide-types/field-definitions.js';

/** One `custom_slide_types` row, as `listPublishedCustomSlideTypes` returns it. */
function dbType(over = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'hero',
    label: 'Hero',
    fields: [{ key: 'headline', type: 'string', label: 'Headline' }],
    defaults: { headline: 'Hello' },
    baseType: 'title-slide',
    ...over,
  };
}

test('a DB type carries the global slide fields, like every other type', () => {
  const def = toRuntimeSlideType(dbType());
  const keys = def.fields.map((f) => f.key);

  assert.deepEqual(
    GLOBAL_SLIDE_FIELD_KEYS.filter((k) => !keys.includes(k)),
    [],
    'every global field is present on the composed DB type',
  );
  // The type's own field is still first: the globals are appended, not merged in.
  assert.equal(keys[0], 'headline');
});

test('the globals on a DB type are the same objects a core type gets', () => {
  const def = toRuntimeSlideType(dbType());
  const core = SLIDE_TYPES['title-slide'];
  for (const key of GLOBAL_SLIDE_FIELD_KEYS) {
    assert.deepEqual(
      def.fields.find((f) => f.key === key),
      core.fields.find((f) => f.key === key),
      `${key} is composed identically on both paths`,
    );
  }
});

test('a DB type gets the i18n key annotations too', () => {
  const ct = dbType();
  const def = toRuntimeSlideType(ct);
  const prefix = `slideType.${customSlideTypeKey(ct)}`;

  assert.equal(def.labelKey, `${prefix}.label`);
  assert.equal(
    def.fields.find((f) => f.key === 'headline').labelKey,
    `${prefix}.field.headline.label`,
  );
  // The injected globals keep their own shared copy keys rather than minting a
  // per-type one — the same rule the registry applies (B140).
  assert.equal(
    def.fields.find((f) => f.key === 'a11yTitle').labelKey,
    'editor.slideField.a11yTitle.label',
  );
});

test('a field the type declares itself is not overwritten by a global', () => {
  const def = toRuntimeSlideType(
    dbType({
      fields: [{ key: 'a11yTitle', type: 'string', label: 'Spoken title' }],
    }),
  );
  const own = def.fields.filter((f) => f.key === 'a11yTitle');
  assert.equal(own.length, 1, 'no duplicate key');
  assert.equal(own[0].label, 'Spoken title');
});

test('composition does not disturb the renderer or the custom markers', () => {
  const def = toRuntimeSlideType(dbType());
  assert.equal(typeof def.renderHtml, 'function');
  assert.equal(def.isCustom, true);
  assert.equal(def.customId, '11111111-1111-1111-1111-111111111111');
});

test('a mediaRef.linkKey may name an injected global field', () => {
  const fields = [
    {
      key: 'credit',
      type: 'string',
      label: 'Credit',
      mediaRef: { label: 'Credit', linkKey: 'slideBgImage' },
    },
  ];
  const result = validateCustomFieldDefinitions(fields);
  assert.equal(result.ok, true);

  // The warning-level finding is what regressed: the walk could not see the
  // injected keys, so it called a perfectly good reference unknown.
  const profile = {
    fieldTypes: ['string'],
    maxFields: 40,
    labelSeverity: 'error',
    globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS,
  };
  const { findings } = walkFieldDefinitions(fields, profile);
  assert.deepEqual(
    findings.filter((f) => f.code === 'media_ref_link_key_unknown'),
    [],
  );
});
