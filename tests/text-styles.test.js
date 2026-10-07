/**
 * The text-style offer model (B464, D220, D221): a type offers `align`/`size`
 * on purpose, at the scope its structure decides; everything else is refused
 * on write, folded once by the schema step, and never rendered.
 *
 * Run with: node --test tests/text-styles.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEXT_STYLE_PROPS,
  checkTextStyleDeclarations,
  foldTextStylesToOffers,
  injectTextStyles,
  instanceCount,
  normalizeTextStyles,
  textStyleOfferFor,
  textStyleOffers,
  textStyleRefusals,
} from '../shared/slide-types/text-styles.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { validateSlideTypeDefinition } from '../shared/slide-types/validate-definition.js';

/** A type with one of each scope, nested array included. */
const DEF = {
  fields: [
    { key: 'title', type: 'string', role: 'heading', textStyle: ['size'] },
    { key: 'body', type: 'markdown', textStyle: ['align', 'size'] },
    { key: 'note', type: 'string' },
    {
      key: 'members',
      type: 'items',
      itemTextStyle: { name: ['align'] },
      itemFields: [
        { key: 'name', type: 'string' },
        { key: 'role', type: 'string' },
      ],
    },
    {
      key: 'rows',
      type: 'items',
      itemFields: [
        {
          key: 'blocks',
          type: 'items',
          itemTextStyle: { title: ['size'] },
          itemFields: [{ key: 'title', type: 'string' }],
        },
      ],
    },
    { key: 'leftTitle', type: 'string' },
    { key: 'rightTitle', type: 'string' },
  ],
  textStyleSets: [
    {
      id: 'column-titles',
      fields: ['leftTitle', 'rightTitle'],
      textStyle: ['align'],
    },
  ],
};

describe('the vocabulary', () => {
  it('is align and size; colour is gone (D221)', () => {
    assert.deepEqual(TEXT_STYLE_PROPS, ['align', 'size']);
  });
});

describe('textStyleOffers / textStyleOfferFor', () => {
  it('collects one storage key per offer, at the scope the structure decides', () => {
    assert.deepEqual(
      [...textStyleOffers(DEF).keys()],
      [
        'title',
        'body',
        'members.*.name',
        'rows.*.blocks.*.title',
        '@column-titles',
      ],
    );
  });

  it('answers every instance of an item field with the one shared offer', () => {
    for (const key of ['members.0.name', 'members.5.name']) {
      assert.equal(textStyleOfferFor(DEF, key)?.key, 'members.*.name');
    }
    assert.equal(
      textStyleOfferFor(DEF, 'rows.1.blocks.2.title')?.key,
      'rows.*.blocks.*.title',
    );
    assert.equal(textStyleOfferFor(DEF, 'rightTitle')?.key, '@column-titles');
  });

  it('answers null for a field the type does not offer', () => {
    assert.equal(textStyleOfferFor(DEF, 'note'), null);
    assert.equal(textStyleOfferFor(DEF, 'members.0.role'), null);
    assert.equal(
      textStyleOfferFor({ fields: [{ key: 'x', type: 'string' }] }, 'x'),
      null,
    );
  });

  it('counts the instances one click styles, nested arrays summed', () => {
    const content = {
      members: [{}, {}, {}],
      rows: [{ blocks: [{}, {}] }, { blocks: [{}] }],
    };
    const offers = textStyleOffers(DEF);
    assert.equal(instanceCount(offers.get('members.*.name'), content), 3);
    assert.equal(
      instanceCount(offers.get('rows.*.blocks.*.title'), content),
      3,
    );
    assert.equal(instanceCount(offers.get('@column-titles'), content), 2);
    assert.equal(instanceCount(offers.get('body'), content), 1);
  });
});

describe('normalizeTextStyles', () => {
  it('keeps offered, non-default values and drops everything else', () => {
    assert.deepEqual(
      normalizeTextStyles(
        {
          body: { align: 'center', size: 'lg', color: 'accent' },
          title: { align: 'center', size: 'sm' }, // align not offered
          note: { size: 'lg' }, // not offered
          'members.2.name': { align: 'center' }, // per instance
          'members.*.name': { align: 'right', size: 'lg' },
          '@column-titles': { align: 'left' }, // the default
        },
        DEF,
      ),
      {
        body: { align: 'center', size: 'lg' },
        title: { size: 'sm' },
        'members.*.name': { align: 'right' },
      },
    );
  });

  it('keeps nothing without a type, or for a type that offers nothing', () => {
    assert.deepEqual(normalizeTextStyles({ body: { size: 'lg' } }, null), {});
    assert.deepEqual(normalizeTextStyles(null, DEF), {});
  });
});

describe('textStyleRefusals', () => {
  const reasons = (raw) =>
    textStyleRefusals(raw, DEF).map((r) => [r.key, r.reason]);

  it('passes a valid map, an absent one and stored defaults', () => {
    assert.deepEqual(reasons(undefined), []);
    assert.deepEqual(
      reasons({
        body: { align: 'left', size: 'md' },
        'members.*.name': { align: 'center' },
      }),
      [],
    );
  });

  it('refuses a per-instance key, naming the shared key', () => {
    const [r] = textStyleRefusals(
      { 'members.3.name': { align: 'center' } },
      DEF,
    );
    assert.equal(r.reason, 'text_style_per_instance');
    assert.match(r.message, /"members\.3\.name"/);
    assert.match(r.message, /"members\.\*\.name"/);
    assert.deepEqual(reasons({ leftTitle: { align: 'center' } }), [
      ['leftTitle', 'text_style_per_instance'],
    ]);
  });

  it('refuses colour, an unoffered key, property and value', () => {
    assert.deepEqual(
      reasons({
        body: { color: 'accent' },
        note: { size: 'lg' },
        title: { align: 'center' },
        'members.*.name': { align: 'middle' },
      }),
      [
        ['body', 'text_style_property_not_offered'],
        ['note', 'text_style_not_offered'],
        ['title', 'text_style_property_not_offered'],
        ['members.*.name', 'text_style_value_not_offered'],
      ],
    );
    assert.match(
      textStyleRefusals({ body: { color: 'accent' } }, DEF)[0].message,
      /colour was removed/,
    );
  });

  it('refuses a malformed map', () => {
    assert.deepEqual(reasons('big'), [['', 'text_style_malformed']]);
    assert.deepEqual(reasons({ body: 'big' }), [
      ['body', 'text_style_malformed'],
    ]);
  });
});

describe('injectTextStyles', () => {
  const html =
    '<h2 data-inline-field="title">T</h2>' +
    '<div class="body" data-inline-field="body">B</div>' +
    '<p data-inline-field="members.0.name">a</p>' +
    '<p data-inline-field="members.1.name">b</p>' +
    '<p data-inline-field="members.1.role">r</p>' +
    '<p data-inline-field="rows.0.blocks.1.title">x</p>' +
    '<h3 data-inline-field="leftTitle">L</h3><h3 data-inline-field="rightTitle">R</h3>';

  it('styles every instance a shared key covers, and nothing beside it', () => {
    const out = injectTextStyles(
      html,
      {
        textStyles: {
          'members.*.name': { align: 'center' },
          'rows.*.blocks.*.title': { size: 'lg' },
          '@column-titles': { align: 'right' },
        },
      },
      DEF,
    );
    assert.match(
      out,
      /<p class="tf-align-center" data-inline-field="members\.0\.name">/,
    );
    assert.match(
      out,
      /<p class="tf-align-center" data-inline-field="members\.1\.name">/,
    );
    assert.match(out, /<p data-inline-field="members\.1\.role">/);
    assert.match(
      out,
      /<p class="tf-size-lg" data-inline-field="rows\.0\.blocks\.1\.title">/,
    );
    assert.equal((out.match(/tf-align-right/g) || []).length, 2);
  });

  it('merges into an existing class attribute', () => {
    const out = injectTextStyles(
      html,
      { textStyles: { body: { size: 'sm' } } },
      DEF,
    );
    assert.match(out, /class="body tf-size-sm" data-inline-field="body"/);
  });

  it('emits nothing for an unoffered key, colour or a per-instance key', () => {
    const out = injectTextStyles(
      html,
      {
        textStyles: {
          note: { size: 'lg' },
          body: { color: 'accent' },
          'members.0.name': { align: 'center' },
        },
      },
      DEF,
    );
    assert.equal(out, html);
  });
});

describe('foldTextStylesToOffers (the v17 -> v18 step)', () => {
  const content = { members: [{}, {}], rows: [{ blocks: [{}] }] };

  it('drops colour and unoffered keys, keeps what is offered', () => {
    assert.deepEqual(
      foldTextStylesToOffers(
        {
          body: { color: 'accent', size: 'lg' },
          note: { size: 'lg' },
          title: { color: 'muted' },
        },
        DEF,
        content,
      ),
      { body: { size: 'lg' } },
    );
  });

  it('folds per-instance keys where every instance agrees', () => {
    assert.deepEqual(
      foldTextStylesToOffers(
        {
          'members.0.name': { align: 'center', color: 'accent' },
          'members.1.name': { align: 'center' },
          leftTitle: { align: 'right' },
          rightTitle: { align: 'right' },
        },
        DEF,
        content,
      ),
      {
        'members.*.name': { align: 'center' },
        '@column-titles': { align: 'right' },
      },
    );
  });

  it('drops a property the instances disagree on, or only some stored', () => {
    assert.equal(
      foldTextStylesToOffers(
        {
          'members.0.name': { align: 'center' },
          'members.1.name': { align: 'right' },
        },
        DEF,
        content,
      ),
      undefined,
    );
    assert.equal(
      foldTextStylesToOffers(
        { 'members.0.name': { align: 'center' } },
        DEF,
        content,
      ),
      undefined,
    );
  });

  it("keeps an unknown type's map minus colour", () => {
    assert.deepEqual(
      foldTextStylesToOffers({ x: { color: 'accent', size: 'lg' } }, null, {}),
      { x: { size: 'lg' } },
    );
  });

  it('is a no-op on a map the current writers produce', () => {
    const current = {
      body: { align: 'center' },
      'members.*.name': { align: 'right' },
    };
    assert.deepEqual(foldTextStylesToOffers(current, DEF, content), current);
  });
});

describe('checkTextStyleDeclarations', () => {
  const errs = (def) => checkTextStyleDeclarations(def, 't');

  it('accepts the fixture and every core type', () => {
    assert.deepEqual(errs(DEF), []);
    for (const [name, def] of Object.entries(SLIDE_TYPES)) {
      assert.deepEqual(checkTextStyleDeclarations(def, name), [], name);
    }
  });

  it('refuses colour, an empty offer and a non-text field', () => {
    assert.equal(
      errs({ fields: [{ key: 'a', type: 'string', textStyle: ['color'] }] })
        .length,
      1,
    );
    assert.equal(
      errs({ fields: [{ key: 'a', type: 'string', textStyle: [] }] }).length,
      1,
    );
    assert.equal(
      errs({ fields: [{ key: 'a', type: 'image', textStyle: ['size'] }] })
        .length,
      1,
    );
  });

  it('refuses a per-instance offer on an item field', () => {
    const [e] = errs({
      fields: [
        {
          key: 'xs',
          type: 'items',
          itemFields: [{ key: 'a', type: 'string', textStyle: ['size'] }],
        },
      ],
    });
    assert.match(e, /itemTextStyle/);
  });

  it('refuses align where the group or the role owns it', () => {
    const grouped = errs({
      fields: [{ key: 'a', type: 'string', group: 'g', textStyle: ['align'] }],
      fieldGroups: [{ id: 'g', alignKey: 'ga' }],
    });
    assert.match(grouped[0], /field group/);
    const listItem = errs({
      fields: [
        {
          key: 'xs',
          type: 'items',
          itemTextStyle: { a: ['align'] },
          itemFields: [{ key: 'a', type: 'string', role: 'list-item' }],
        },
      ],
    });
    assert.match(listItem[0], /never aligns/);
  });

  it('refuses a set member that also has its own offer, or sits in two sets', () => {
    const fields = [
      { key: 'a', type: 'string', textStyle: ['size'] },
      { key: 'b', type: 'string' },
      { key: 'c', type: 'string' },
    ];
    assert.equal(
      errs({
        fields,
        textStyleSets: [{ id: 's', fields: ['a', 'b'], textStyle: ['size'] }],
      }).length,
      1,
    );
    assert.equal(
      errs({
        fields,
        textStyleSets: [
          { id: 's', fields: ['b', 'c'], textStyle: ['size'] },
          { id: 't', fields: ['c', 'b'], textStyle: ['size'] },
        ],
      }).length,
      2,
    );
  });

  it('is what the definition validator reports', () => {
    const report = validateSlideTypeDefinition(
      {
        label: 'X',
        fields: [{ key: 'a', type: 'string', textStyle: ['color'] }],
        renderHtml: () => '<div class="slide slide-x"></div>',
      },
      'x-slide',
    );
    assert.ok(report.errors.some((e) => /textStyle/.test(e)));
  });
});

describe('the pilot: Image blocks offers nothing (D220)', () => {
  it('no team-cards text field has an offer', () => {
    const def = SLIDE_TYPES['team-cards-slide'];
    assert.equal(textStyleOffers(def).size, 0);
    for (const key of ['title', 'members.0.name', 'members.3.name']) {
      assert.equal(textStyleOfferFor(def, key), null, key);
    }
  });

  it('a per-instance key there is refused as not offered', () => {
    const [r] = textStyleRefusals(
      { 'members.3.name': { align: 'center' } },
      SLIDE_TYPES['team-cards-slide'],
    );
    assert.equal(r.reason, 'text_style_not_offered');
  });
});
