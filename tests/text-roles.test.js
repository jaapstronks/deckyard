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
  allowedAlignValues,
  resolveFieldRole,
  fieldAllowsAlign,
  fieldAllowedAlignValues,
} from '../shared/slide-types/text-roles.js';
import { TEXT_ALIGN_VALUES } from '../shared/slide-types/text-styles.js';
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

describe('allowedAlignValues (value-level affordances)', () => {
  it('a quote offers left/centre but not right (former hardcode, now in the table)', () => {
    assert.deepEqual(allowedAlignValues('quote'), ['left', 'center']);
  });

  it('list-item offers no alignment at all', () => {
    assert.deepEqual(allowedAlignValues('list-item'), []);
  });

  it('default roles offer the full set', () => {
    assert.deepEqual(allowedAlignValues('heading'), ['left', 'center', 'right']);
  });
});

describe('real schemas: marker-anchored fields are tagged, shapes are not', () => {
  const cases = [
    // [type, key, allowsAlign]
    ['list-slide', 'items.0.text', false],
    ['list-slide', 'items.0.title', false],
    ['list-slide', 'title', true],
    ['lijstje-slide', 'items.0.text', false],
    ['process-slide', 'items.0.title', false],
    ['process-slide', 'items.0.text', false],
    ['timeline-slide', 'items.0.date', false],
    ['timeline-slide', 'items.0.title', false],
    ['timeline-slide', 'items.0.text', false],
    // node/shape diagrams: text sits inside a shape, centering is legitimate
    ['cycle-slide', 'items.0.text', true],
    ['funnel-slide', 'items.0.label', true],
    ['pyramid-slide', 'levels.0.text', true],
  ];
  for (const [type, key, expected] of cases) {
    it(`${type} · ${key} allowsAlign=${expected}`, () => {
      const def = SLIDE_TYPES[type];
      assert.ok(def, `${type} should be registered`);
      assert.equal(fieldAllowsAlign(def.fields, key), expected);
    });
  }

  it("quote field offers left/centre only", () => {
    assert.deepEqual(fieldAllowedAlignValues(SLIDE_TYPES['quote-slide'].fields, 'quote'), [
      'left',
      'center',
    ]);
  });
});

describe('drift guard: declared roles stay in the vocabulary', () => {
  // Walk every field + itemField across all registered slide types and collect
  // any `role` value; each must be a known role with an affordance entry. This
  // catches a typo'd role (role:'listitem') the way field-types.test.js catches
  // an unknown field type.
  function collectRoles(fields, out, where) {
    if (!Array.isArray(fields)) return;
    for (const f of fields) {
      if (f && f.role != null) out.push({ role: f.role, where: `${where}.${f.key}` });
      if (f && Array.isArray(f.itemFields)) collectRoles(f.itemFields, out, `${where}.${f.key}[]`);
    }
  }

  it('every declared role is in TEXT_ROLES and has affordances', () => {
    const declared = [];
    for (const [type, def] of Object.entries(SLIDE_TYPES)) {
      collectRoles(def?.fields, declared, type);
    }
    for (const { role, where } of declared) {
      assert.ok(TEXT_ROLES.includes(role), `${where}: unknown role '${role}'`);
      assert.ok(ROLE_AFFORDANCES[role], `${where}: role '${role}' has no affordances`);
    }
  });

  it('every affordance align set is a subset of the alignment vocabulary', () => {
    for (const [role, aff] of Object.entries(ROLE_AFFORDANCES)) {
      assert.ok(Array.isArray(aff.align), `${role}: align must be an array`);
      for (const v of aff.align) {
        assert.ok(TEXT_ALIGN_VALUES.includes(v), `${role}: '${v}' is not a valid align value`);
      }
    }
  });
});
