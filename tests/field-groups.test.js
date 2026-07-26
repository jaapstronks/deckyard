/**
 * Field-group model: the second alignment affordance axis. Covers the group
 * declaration readers, alignment resolution and root-class emission, the
 * `{values, owner}` resolver that composes group + role, and the schema
 * invariants every declared group on a real slide type must satisfy.
 *
 * Run with: node --test tests/field-groups.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  getFieldGroups,
  getFieldGroup,
  fieldGroupId,
  groupAlignValues,
  resolveGroupAlign,
  groupAlignClass,
} from '../shared/slide-types/field-groups.js';
import { resolveFieldDef } from '../shared/slide-types/field-lookup.js';
import { fieldAlignAffordance, fieldAllowedAlignValues } from '../shared/slide-types/text-roles.js';
import { TEXT_ALIGN_VALUES } from '../shared/slide-types/text-styles.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

/** A minimal definition exercising every branch. */
const DEF = {
  fields: [
    { key: 'title', group: 'title-block' },
    { key: 'subheading', group: 'title-block' },
    { key: 'caption', role: 'caption' },
    { key: 'items', itemFields: [{ key: 'text', role: 'list-item' }, { key: 'label', group: 'title-block' }] },
    { key: 'blockAlign', type: 'enum', options: ['left', 'center'] },
  ],
  fieldGroups: [
    {
      id: 'title-block',
      alignKey: 'blockAlign',
      align: ['left', 'center'],
      defaultAlign: 'left',
      alignClass: 'is-align',
    },
  ],
};

describe('field-lookup', () => {
  it('resolves plain and dotted keys, and null for misses', () => {
    assert.equal(resolveFieldDef(DEF.fields, 'title')?.key, 'title');
    assert.equal(resolveFieldDef(DEF.fields, 'items.0.text')?.key, 'text');
    assert.equal(resolveFieldDef(DEF.fields, 'items.3.label')?.key, 'label');
    assert.equal(resolveFieldDef(DEF.fields, 'nope'), null);
    assert.equal(resolveFieldDef(DEF.fields, 'items.0.nope'), null);
    assert.equal(resolveFieldDef(null, 'title'), null);
    assert.equal(resolveFieldDef(DEF.fields, ''), null);
  });
});

describe('field-groups: declaration readers', () => {
  it('getFieldGroups returns [] for a type declaring none', () => {
    assert.deepEqual(getFieldGroups({}), []);
    assert.deepEqual(getFieldGroups(null), []);
    assert.deepEqual(getFieldGroups({ fieldGroups: 'nope' }), []);
  });

  it('getFieldGroup finds by id and returns null otherwise', () => {
    assert.equal(getFieldGroup(DEF, 'title-block')?.alignKey, 'blockAlign');
    assert.equal(getFieldGroup(DEF, 'absent'), null);
    assert.equal(getFieldGroup(DEF, ''), null);
  });

  it('fieldGroupId reads membership, including through itemFields', () => {
    assert.equal(fieldGroupId(DEF.fields, 'title'), 'title-block');
    assert.equal(fieldGroupId(DEF.fields, 'items.0.label'), 'title-block');
    assert.equal(fieldGroupId(DEF.fields, 'caption'), null);
    assert.equal(fieldGroupId(DEF.fields, 'items.0.text'), null);
    assert.equal(fieldGroupId(DEF.fields, 'nope'), null);
  });

  it('a blank group string is not membership', () => {
    const fields = [{ key: 'a', group: '   ' }];
    assert.equal(fieldGroupId(fields, 'a'), null);
  });
});

describe('field-groups: alignment resolution', () => {
  it('offers the declared values, falling back to the full vocabulary', () => {
    assert.deepEqual(groupAlignValues(getFieldGroup(DEF, 'title-block')), ['left', 'center']);
    assert.deepEqual(groupAlignValues({ id: 'g' }), TEXT_ALIGN_VALUES);
    assert.deepEqual(groupAlignValues(getFieldGroup(DEF, 'absent')), []);
  });

  it('drops values the vocabulary does not know', () => {
    assert.deepEqual(groupAlignValues({ id: 'g', align: ['left', 'diagonal'] }), ['left']);
  });

  it('an all-junk align list falls back rather than offering nothing', () => {
    assert.deepEqual(groupAlignValues({ id: 'g', align: ['diagonal'] }), TEXT_ALIGN_VALUES);
  });

  it('resolveGroupAlign reads the content key and validates it', () => {
    assert.equal(resolveGroupAlign(getFieldGroup(DEF, 'title-block'), { blockAlign: 'center' }), 'center');
    assert.equal(resolveGroupAlign(getFieldGroup(DEF, 'title-block'), { blockAlign: 'right' }), 'left');
    assert.equal(resolveGroupAlign(getFieldGroup(DEF, 'title-block'), {}), 'left');
    assert.equal(resolveGroupAlign(getFieldGroup(DEF, 'title-block'), null), 'left');
    assert.equal(resolveGroupAlign(getFieldGroup(DEF, 'absent'), { blockAlign: 'center' }), 'left');
  });

  it('a defaultAlign outside the offered set falls back to the first offered', () => {
    const odd = { id: 'g', alignKey: 'k', align: ['center'], defaultAlign: 'left' };
    assert.equal(resolveGroupAlign(odd, {}), 'center');
  });
});

describe('field-groups: root class', () => {
  it('emits nothing for the default value, so untouched markup is unchanged', () => {
    assert.equal(groupAlignClass(getFieldGroup(DEF, 'title-block'), {}), '');
    assert.equal(groupAlignClass(getFieldGroup(DEF, 'title-block'), { blockAlign: 'left' }), '');
  });

  it('emits <alignClass>-<value> for a non-default value', () => {
    assert.equal(groupAlignClass(getFieldGroup(DEF, 'title-block'), { blockAlign: 'center' }), 'is-align-center');
  });

  it('honours a custom class prefix and falls back to is-align', () => {
    const custom = { id: 'g', alignKey: 'k', alignClass: 'is-caption-align' };
    assert.equal(groupAlignClass(custom, { k: 'center' }), 'is-caption-align-center');
    assert.equal(groupAlignClass({ id: 'g', alignKey: 'k' }, { k: 'center' }), 'is-align-center');
  });

  it('an unknown group contributes no class', () => {
    assert.equal(groupAlignClass(getFieldGroup(DEF, 'absent'), { blockAlign: 'center' }), '');
  });
});

describe('fieldAlignAffordance: one resolver, three owners', () => {
  it('a group member hands alignment to the group', () => {
    assert.deepEqual(fieldAlignAffordance(DEF.fields, 'title'), {
      values: [],
      owner: 'group',
      groupId: 'title-block',
    });
  });

  it('a marker-anchored role can never align', () => {
    assert.deepEqual(fieldAlignAffordance(DEF.fields, 'items.0.text'), {
      values: [],
      owner: 'role',
      groupId: null,
    });
  });

  it('a standalone field keeps its own alignment', () => {
    const out = fieldAlignAffordance(DEF.fields, 'caption');
    assert.equal(out.owner, 'field');
    assert.deepEqual(out.values, TEXT_ALIGN_VALUES);
  });

  it('group membership wins over the role that would otherwise allow align', () => {
    const fields = [{ key: 'a', role: 'heading', group: 'g' }];
    assert.equal(fieldAlignAffordance(fields, 'a').owner, 'group');
  });

  it('fieldAllowedAlignValues stays the derived view, so the renderer gates for free', () => {
    assert.deepEqual(fieldAllowedAlignValues(DEF.fields, 'title'), []);
    assert.deepEqual(fieldAllowedAlignValues(DEF.fields, 'caption'), TEXT_ALIGN_VALUES);
  });
});

describe('every real slide type declares coherent groups', () => {
  /** Collect `group` declarations, descending into itemFields. */
  function collectGroups(fields, out, where) {
    for (const f of fields || []) {
      if (f && typeof f.group === 'string' && f.group.trim()) {
        out.push({ group: f.group.trim(), where: `${where}.${f.key}` });
      }
      if (f && Array.isArray(f.itemFields)) collectGroups(f.itemFields, out, `${where}.${f.key}[]`);
    }
  }

  it('every field-level group is declared in its type fieldGroups', () => {
    for (const [type, def] of Object.entries(SLIDE_TYPES)) {
      const used = [];
      collectGroups(def?.fields, used, type);
      const declared = new Set(getFieldGroups(def).map((g) => g?.id));
      for (const { group, where } of used) {
        assert.ok(declared.has(group), `${where}: group '${group}' is not in fieldGroups`);
      }
    }
  });

  it('every declared group is well-formed and actually used', () => {
    for (const [type, def] of Object.entries(SLIDE_TYPES)) {
      const used = [];
      collectGroups(def?.fields, used, type);
      const usedIds = new Set(used.map((u) => u.group));
      for (const group of getFieldGroups(def)) {
        const where = `${type}.fieldGroups.${group?.id}`;
        assert.ok(group?.id, `${type}: a fieldGroups entry has no id`);
        assert.ok(usedIds.has(group.id), `${where}: declared but no field joins it`);
        assert.equal(
          typeof group.alignKey,
          'string',
          `${where}: needs an alignKey naming the content field that stores the value`
        );
        const values = groupAlignValues(group);
        assert.ok(values.length >= 2, `${where}: a group offering fewer than two values is not a choice`);
        for (const v of values) {
          assert.ok(TEXT_ALIGN_VALUES.includes(v), `${where}: '${v}' is not a valid align value`);
        }
      }
    }
  });

  it('the alignKey is a declared enum field offering exactly the group values', () => {
    for (const [type, def] of Object.entries(SLIDE_TYPES)) {
      for (const group of getFieldGroups(def)) {
        const where = `${type}.fieldGroups.${group?.id}`;
        const field = resolveFieldDef(def?.fields, group?.alignKey);
        assert.ok(field, `${where}: alignKey '${group?.alignKey}' is not a declared field`);
        assert.equal(field.type, 'enum', `${where}: alignKey field must be an enum`);
        const options = (field.options || []).map((o) => (typeof o === 'string' ? o : o?.value));
        assert.deepEqual(
          options,
          groupAlignValues(group),
          `${where}: enum options and group align values must match`
        );
      }
    }
  });
});
