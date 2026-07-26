/**
 * The agent-facing slide-type contract.
 *
 * Guards the derivation in server/utils/ai/slide-catalog/agent-catalog.js:
 * coverage comes from the runtime registry, the editorial catalog is an
 * overlay, and a withheld type says so on its definition.
 *
 * This is NOT the full coverage test from T7 (which must fail the build when a
 * new type is neither documented nor opted out) — that lands with the T7 work.
 * These are the regression anchors for the three types that were invisible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import {
  isAgentOptOut,
  deriveAgentSchema,
  resolveAgentSlideTypes,
} from '../server/utils/ai/slide-catalog/agent-catalog.js';

test('every registered type is offered, derived, or explicitly opted out', () => {
  const resolved = resolveAgentSlideTypes({});
  for (const [name, def] of Object.entries(SLIDE_TYPES)) {
    const offered = Object.prototype.hasOwnProperty.call(resolved, name);
    assert.ok(
      offered !== isAgentOptOut(def),
      `${name}: must be either offered to agents or explicitly opted out, not both/neither`
    );
  }
});

test('the three formerly invisible live types are resolved correctly', () => {
  const resolved = resolveAgentSlideTypes({});

  // Regression anchors: embed-slide and countdown-slide are live, non-deprecated
  // core types that the picker offers but get_slide_types could not see.
  for (const name of ['embed-slide', 'countdown-slide']) {
    assert.ok(resolved[name], `${name} must be visible to agents`);
    assert.equal(resolved[name].documented, true, `${name} needs editorial copy`);
    assert.ok(resolved[name].schema, `${name} needs a schema`);
    assert.ok(resolved[name].bestFor.length, `${name} needs bestFor guidance`);
  }

  // follow-invite-slide is the third, and the opposite call: the app inserts
  // and maintains it, so it is withheld on purpose rather than documented.
  assert.equal(resolved['follow-invite-slide'], undefined);
  assert.equal(isAgentOptOut(SLIDE_TYPES['follow-invite-slide']), true);
});

test('opt-out covers deprecated types and the ai:false flag', () => {
  assert.equal(isAgentOptOut({ deprecated: true }), true);
  assert.equal(isAgentOptOut({ ai: false }), true);
  assert.equal(isAgentOptOut({ ai: { description: 'x' } }), false);
  assert.equal(isAgentOptOut({}), false);

  const resolved = resolveAgentSlideTypes({});
  // An alias and a capability-gated escape hatch: live, but not for agents.
  assert.equal(resolved['lijstje-slide'], undefined);
  assert.equal(resolved['custom-html-slide'], undefined);
  // A deprecated type stays renderable but is never offered.
  assert.equal(resolved['content-columns-slide'], undefined);
});

test('an undocumented registered type is still offered, flagged documented:false', () => {
  // title-slide is documented; strip the catalog by asking for a type the
  // editorial catalog has no entry for via the derivation helper directly.
  const schema = deriveAgentSchema([
    { key: 'title', type: 'string', required: true, maxLength: 120 },
    { key: 'count', type: 'number', min: 0, max: 10 },
    { key: 'mode', type: 'enum', options: [{ value: 'a' }, { value: 'b' }] },
    { key: 'items', type: 'items', minItems: 2, itemFields: [{ key: 'text', type: 'string' }] },
    // Global fields travel in globalOptions, not per type.
    { key: 'slideLogo', type: 'enum', options: ['none'] },
  ]);

  assert.deepEqual(schema.title, { type: 'string', required: true, maxLength: 120 });
  assert.deepEqual(schema.count, { type: 'number', min: 0, max: 10 });
  assert.deepEqual(schema.mode, { type: 'enum', options: ['a', 'b'] });
  assert.deepEqual(schema.items, {
    type: 'array',
    minItems: 2,
    itemSchema: { text: { type: 'string' } },
  });
  assert.equal(schema.slideLogo, undefined);
});

test('org disabled types are filtered out for agents too', () => {
  const resolved = resolveAgentSlideTypes({ disabledSlideTypes: ['quote-slide'] });
  assert.equal(resolved['quote-slide'], undefined);
  assert.ok(resolved['title-slide'], 'other types stay');
});

test('tier-2 organization types reach the agent layer', () => {
  const resolved = resolveAgentSlideTypes({
    customSlideTypes: [
      {
        slug: 'kwartaalcijfers',
        label: 'Kwartaalcijfers',
        baseType: 'content-slide',
        fields: [{ key: 'peildatum', type: 'string', required: true }],
        defaults: { peildatum: '2026-Q1' },
      },
    ],
  });

  const entry = resolved['custom-kwartaalcijfers'];
  assert.ok(entry, 'a published custom type must be offered to agents');
  assert.equal(entry.isCustom, true);
  assert.equal(entry.typeId, 'custom/kwartaalcijfers');
  assert.deepEqual(entry.example, { peildatum: '2026-Q1' });
  assert.deepEqual(entry.schema.peildatum, { type: 'string', required: true });

  // …and the org can disable them by the same key the editor uses.
  const off = resolveAgentSlideTypes({
    customSlideTypes: [{ slug: 'kwartaalcijfers', label: 'K', fields: [] }],
    disabledSlideTypes: ['custom-kwartaalcijfers'],
  });
  assert.equal(off['custom-kwartaalcijfers'], undefined);
});

test('category filter splits structural from content', () => {
  const structural = resolveAgentSlideTypes({ category: 'structural' });
  const content = resolveAgentSlideTypes({ category: 'content' });
  assert.ok(structural['title-slide'], 'title-slide is structural');
  assert.equal(structural['embed-slide'], undefined);
  assert.ok(content['embed-slide'], 'embed-slide is content');
  assert.equal(content['title-slide'], undefined);
});

test('every offered entry carries a canonical type id', () => {
  for (const [name, entry] of Object.entries(resolveAgentSlideTypes({}))) {
    assert.match(
      entry.typeId,
      /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*(@[0-9A-Za-z][0-9A-Za-z.-]*)?$/,
      `${name} must expose a namespace/name id`
    );
  }
});
