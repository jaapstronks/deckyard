/**
 * Title-slide `title-block` field group: the first type to adopt the group
 * alignment model. Covers the root-class emission, the layout-variant
 * catalogue that writes it, and the two migration guarantees — an untouched
 * deck renders unchanged, and an `align` stored on a member before the group
 * existed goes inert instead of needing a migration.
 *
 * Run with: node --test tests/title-block-align.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SLIDE_TYPES } from '../shared/slide-types/registry.js';
import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import {
  getLayoutVariants,
  activeLayoutVariantId,
  applyLayoutVariant,
} from '../shared/slide-types/layout-variants.js';
import { fieldAlignAffordance } from '../shared/slide-types/text-roles.js';
import { getFieldGroup } from '../shared/slide-types/field-groups.js';

const DEF = SLIDE_TYPES['title-slide'];
const render = (content) =>
  renderSlideHtml({ type: 'title-slide', content }, { theme: { titleLayout: 'bottom' } });

describe('title-slide declares a title-block group', () => {
  it('title, subtitle and meta are members; the align field is not', () => {
    const groupOf = (key) => DEF.fields.find((f) => f.key === key)?.group || null;
    assert.equal(groupOf('title'), 'title-block');
    assert.equal(groupOf('subheading'), 'title-block');
    assert.equal(groupOf('meta'), 'title-block');
    assert.equal(groupOf('titleBlockAlign'), null);
    assert.equal(groupOf('logoCorner'), null);
  });

  it('the group offers left and centre only', () => {
    const group = getFieldGroup(DEF, 'title-block');
    assert.deepEqual(group.align, ['left', 'center']);
    assert.equal(group.defaultAlign, 'left');
    assert.equal(group.alignKey, 'titleBlockAlign');
  });

  it('every member hands its alignment to the group', () => {
    for (const key of ['title', 'subheading', 'meta']) {
      const out = fieldAlignAffordance(DEF.fields, key);
      assert.equal(out.owner, 'group', `${key} should be group-owned`);
      assert.equal(out.groupId, 'title-block');
      assert.deepEqual(out.values, []);
    }
  });
});

describe('title-slide renders the group alignment as one root class', () => {
  it('the default emits no class, so untouched decks are unchanged', () => {
    const before = render({ title: 'Hi' });
    const explicit = render({ title: 'Hi', titleBlockAlign: 'left' });
    assert.doesNotMatch(before, /is-align-/);
    assert.equal(before, explicit);
  });

  it('centre emits is-align-center on the slide root', () => {
    const html = render({ title: 'Hi', titleBlockAlign: 'center' });
    assert.match(html, /class="slide slide-title-universal[^"]*\bis-align-center\b/);
  });

  it('an unknown stored value falls back to the default', () => {
    assert.doesNotMatch(render({ title: 'Hi', titleBlockAlign: 'right' }), /is-align-/);
    assert.doesNotMatch(render({ title: 'Hi', titleBlockAlign: 'diagonal' }), /is-align-/);
  });
});

describe('stored per-field align on a member goes inert without migration', () => {
  it('a member no longer emits tf-align-*', () => {
    const html = render({
      title: 'Hi',
      subheading: 'Sub',
      meta: 'Meta',
      textStyles: {
        title: { align: 'center' },
        subheading: { align: 'center' },
        meta: { align: 'right' },
      },
    });
    assert.doesNotMatch(html, /tf-align-/);
  });

  it('colour and size on the same member still apply', () => {
    const html = render({
      title: 'Hi',
      textStyles: { title: { align: 'center', color: 'muted', size: 'lg' } },
    });
    assert.doesNotMatch(html, /tf-align-/);
    assert.match(html, /tf-color-muted/);
    assert.match(html, /tf-size-lg/);
  });
});

describe('the layout switcher is the group control', () => {
  it('declares one tile per offered alignment', () => {
    const variants = getLayoutVariants(DEF);
    assert.deepEqual(
      variants.map((v) => v.id),
      ['block-left', 'block-center']
    );
    for (const v of variants) {
      assert.equal(typeof v.set?.titleBlockAlign, 'string');
      assert.ok(v.schematic?.align, 'each tile draws its alignment');
    }
  });

  it('resolves the active tile, including on decks predating the field', () => {
    assert.equal(activeLayoutVariantId({ type: 'title-slide', content: {} }, DEF), 'block-left');
    assert.equal(
      activeLayoutVariantId({ type: 'title-slide', content: { titleBlockAlign: 'center' } }, DEF),
      'block-center'
    );
  });

  it('picking a tile writes the group field and nothing else', () => {
    const slide = { type: 'title-slide', content: { title: 'Hi' } };
    const centre = getLayoutVariants(DEF).find((v) => v.id === 'block-center');
    assert.equal(applyLayoutVariant(slide, centre), true);
    assert.deepEqual(slide.content, { title: 'Hi', titleBlockAlign: 'center' });
    assert.equal(applyLayoutVariant(slide, centre), false, 're-picking is a no-op');
  });
});
