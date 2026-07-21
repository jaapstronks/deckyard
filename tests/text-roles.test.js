/**
 * Semantic text-role affordance model: role vocabulary, affordance table, the
 * dotted-path field-key resolver, and alignment gating. Also asserts the real
 * list-slide / lijstje-slide schemas tag their item fields as list-item.
 *
 * Run with: node --test tests/text-roles.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEXT_ROLES,
  DEFAULT_TEXT_ROLE,
  ROLE_AFFORDANCES,
  roleAllowsAlign,
  resolveFieldRole,
  fieldAllowsAlign,
} from '../shared/slide-types/text-roles.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

describe('role vocabulary + affordances', () => {
  it('every role in the vocabulary has an affordance entry', () => {
    for (const role of TEXT_ROLES) {
      assert.ok(ROLE_AFFORDANCES[role], `missing affordances for role ${role}`);
    }
  });

  it('the default role is a real, align-allowing role', () => {
    assert.ok(TEXT_ROLES.includes(DEFAULT_TEXT_ROLE));
    assert.equal(roleAllowsAlign(DEFAULT_TEXT_ROLE), true);
  });

  it('only list-item forbids block alignment', () => {
    assert.equal(roleAllowsAlign('list-item'), false);
    assert.equal(roleAllowsAlign('heading'), true);
    assert.equal(roleAllowsAlign('prose'), true);
    assert.equal(roleAllowsAlign('quote'), true);
    assert.equal(roleAllowsAlign('caption'), true);
    assert.equal(roleAllowsAlign('label'), true);
  });

  it('an unknown/absent role falls back to the safe default', () => {
    assert.equal(roleAllowsAlign(undefined), true);
    assert.equal(roleAllowsAlign('bogus'), true);
  });
});

describe('resolveFieldRole', () => {
  const fields = [
    { key: 'title', type: 'string' },
    { key: 'body', type: 'markdown', role: 'prose' },
    {
      key: 'items',
      type: 'items',
      itemFields: [
        { key: 'title', type: 'string', role: 'list-item' },
        { key: 'text', type: 'string', role: 'list-item' },
      ],
    },
  ];

  it('resolves a flat key to its role (or the default)', () => {
    assert.equal(resolveFieldRole(fields, 'title'), DEFAULT_TEXT_ROLE); // untagged
    assert.equal(resolveFieldRole(fields, 'body'), 'prose');
  });

  it('resolves a dotted item key through itemFields', () => {
    assert.equal(resolveFieldRole(fields, 'items.0.text'), 'list-item');
    assert.equal(resolveFieldRole(fields, 'items.3.title'), 'list-item');
  });

  it('falls back to the default for unknown keys or missing schema', () => {
    assert.equal(resolveFieldRole(fields, 'nope'), DEFAULT_TEXT_ROLE);
    assert.equal(resolveFieldRole(fields, 'items.0.nope'), DEFAULT_TEXT_ROLE);
    assert.equal(resolveFieldRole(null, 'title'), DEFAULT_TEXT_ROLE);
  });

  it('ignores an unknown role value on a field', () => {
    const bad = [{ key: 'x', type: 'string', role: 'not-a-role' }];
    assert.equal(resolveFieldRole(bad, 'x'), DEFAULT_TEXT_ROLE);
  });

  it('fieldAllowsAlign composes resolve + affordance', () => {
    assert.equal(fieldAllowsAlign(fields, 'items.0.text'), false);
    assert.equal(fieldAllowsAlign(fields, 'title'), true);
  });
});

describe('real list schemas tag their item fields', () => {
  for (const type of ['list-slide', 'lijstje-slide']) {
    it(`${type} item text + title are role:'list-item'`, () => {
      const def = SLIDE_TYPES[type];
      assert.ok(def, `${type} should be registered`);
      assert.equal(fieldAllowsAlign(def.fields, 'items.0.text'), false);
      assert.equal(fieldAllowsAlign(def.fields, 'items.0.title'), false);
      // the slide title itself still aligns
      assert.equal(fieldAllowsAlign(def.fields, 'title'), true);
    });
  }
});
