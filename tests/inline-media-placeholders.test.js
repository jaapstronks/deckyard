import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_TYPES } from '../shared/slide-types/index.js';
import { ensureLogos } from '../shared/slide-types/types/logo-wall-slide.js';
import { ensureMembers } from '../shared/slide-types/types/team-cards-slide.js';

/**
 * Empty-slot media affordances (editor-UI track, phase 1c): empty image slots
 * must be clickable in the editor canvas so a FIRST image can be added from
 * the slide, without leaking editor placeholders into present/export renders.
 */

test('content-columns: empty column renders a clickable placeholder in edit mode only', () => {
  const def = SLIDE_TYPES['content-columns-slide'];
  const content = { title: 'T', columnCount: 2 };

  const editHtml = def.renderHtml(content, {}, { mode: 'edit' });
  const editPlaceholders = editHtml.match(/cc-image-placeholder/g) || [];
  assert.ok(editPlaceholders.length >= 2, 'each empty column gets a placeholder in edit mode');
  assert.match(editHtml, /cc-image-placeholder[^>]*data-inline-photo="1"/s);

  for (const ctx of [undefined, {}, { mode: 'present' }, { mode: 'thumb' }]) {
    const html = def.renderHtml(content, {}, ctx);
    assert.ok(!html.includes('cc-image-placeholder'), `no placeholder in mode ${ctx?.mode}`);
  }
});

test('content-columns: a filled column renders the image, not the placeholder', () => {
  const def = SLIDE_TYPES['content-columns-slide'];
  const content = { title: 'T', columnCount: 2, col1Image: '/x.png', col1Alt: 'x' };
  const html = def.renderHtml(content, {}, { mode: 'edit' });
  assert.match(html, /<img src="\/x\.png"/);
  // column 1 filled: its cc-image is not a placeholder; column 2 still empty
  assert.ok(!/cc-image-placeholder[^>]*data-inline-photo="1"/s.test(html));
  assert.match(html, /cc-image-placeholder[^>]*data-inline-photo="2"/s);
});

test('image-text: empty placeholder and filled image both carry data-inline-photo', () => {
  const def = SLIDE_TYPES['image-text-slide'];

  const empty = def.renderHtml({ title: 'T', body: 'b' });
  assert.match(empty, /image-placeholder is-empty[^>]*data-inline-photo="0"/s);

  const filled = def.renderHtml({ title: 'T', body: 'b', image: '/y.png', alt: 'y' });
  assert.match(filled, /<img[^>]*data-inline-photo="0"/s);
  assert.ok(!filled.includes('image-placeholder'));
});

test('logo-wall: legacy numbered deck is inline-clickable (no logos[] gate)', () => {
  const def = SLIDE_TYPES['logo-wall-slide'];
  // A deck backed only by the legacy numbered fields (no logos[] array).
  const content = { logoCount: '1', logo1Name: 'Acme' };
  const html = def.renderHtml(content, {}, { mode: 'edit' });
  assert.match(html, /logo-wall-placeholder is-empty[^>]*data-inline-photo="0"/s);
  assert.match(html, /logo-wall-item[^>]*data-inline-item="logos"[^>]*data-inline-item-index="0"/s);
});

test('logo-wall: an empty wall gets a clickable placeholder cell in edit mode only', () => {
  const def = SLIDE_TYPES['logo-wall-slide'];
  const empty = { title: 'Partners' }; // no logos, no numbered fields

  const editHtml = def.renderHtml(empty, {}, { mode: 'edit' });
  assert.match(editHtml, /logo-wall-placeholder is-empty[^>]*data-inline-photo="0"/s);

  for (const ctx of [undefined, {}, { mode: 'present' }, { mode: 'thumb' }]) {
    const html = def.renderHtml(empty, {}, ctx);
    assert.ok(!/data-inline-photo/.test(html), `no clickable cell in mode ${ctx?.mode}`);
    assert.match(html, /logo-wall-empty/);
  }
});

test('logo-wall: a filled logo carries data-inline-photo + item index', () => {
  const def = SLIDE_TYPES['logo-wall-slide'];
  const html = def.renderHtml(
    { logos: [{ image: '/a.png', name: 'A' }, { image: '', name: 'B' }] },
    {},
    { mode: 'edit' }
  );
  assert.match(html, /<img class="logo-wall-img"[^>]*data-inline-photo="0"/s);
  assert.match(html, /logo-wall-placeholder is-empty[^>]*data-inline-photo="1"/s);
  assert.match(html, /data-inline-item-index="1"/);
});

test('ensureLogos migrates legacy numbered fields into logos[]', () => {
  const content = { logoCount: '2', logo1Name: 'A', logo1Image: '/a.png', logo2Name: 'B' };
  ensureLogos(content);
  assert.ok(Array.isArray(content.logos));
  assert.equal(content.logos.length, 2);
  assert.equal(content.logos[0].image, '/a.png');
  assert.equal(content.logos[1].name, 'B');
  // Idempotent: a second pass leaves the array untouched.
  const before = JSON.stringify(content.logos);
  ensureLogos(content);
  assert.equal(JSON.stringify(content.logos), before);
});

test('ensureLogos seeds one empty slot for a genuinely empty wall', () => {
  const content = { title: 'Partners' };
  ensureLogos(content);
  assert.deepEqual(content.logos, [{ image: '', name: '', alt: '', link: '' }]);
});

test('team-cards: legacy numbered deck emits members[] paths + clickable photo', () => {
  const def = SLIDE_TYPES['team-cards-slide'];
  const content = { cardCount: '1', card1Name: 'Ada', card1Byline: 'Engineer' };
  const html = def.renderHtml(content);
  assert.match(html, /class="[^"]*team-card-photo[^"]*is-empty"[^>]*data-inline-photo="0"/s);
  assert.match(html, /data-inline-field="members\.0\.name"/);
  assert.match(html, /data-inline-item="members"[^>]*data-inline-item-index="0"/s);
});

test('ensureMembers folds legacy cards into members[]; empty stays []', () => {
  const legacy = { cardCount: '1', card1Name: 'Ada', card1Byline: 'Engineer' };
  ensureMembers(legacy);
  assert.equal(legacy.members.length, 1);
  assert.equal(legacy.members[0].name, 'Ada');

  const empty = { title: 'Team' };
  ensureMembers(empty);
  assert.deepEqual(empty.members, []);
});

test('quote: empty primary portrait slot is clickable in edit mode only', () => {
  const def = SLIDE_TYPES['quote-slide'];
  const content = { quote: 'Hi', authorName: 'Ada', authorTitle: 'Eng' };

  const editHtml = def.renderHtml(content, {}, { mode: 'edit' });
  assert.match(editHtml, /class="[^"]*quote-portrait[^"]*is-empty"[^>]*data-inline-photo="1"/s);

  for (const ctx of [undefined, {}, { mode: 'present' }]) {
    const html = def.renderHtml(content, {}, ctx);
    assert.ok(!html.includes('quote-portrait'), `no portrait slot in mode ${ctx?.mode}`);
  }
});

test('quote: a filled first portrait shows the next empty slot as the add target', () => {
  const def = SLIDE_TYPES['quote-slide'];
  const content = {
    quote: 'Hi',
    authorName: 'Ada',
    authorTitle: 'Eng',
    authorImage1: '/p.png',
  };
  const html = def.renderHtml(content, {}, { mode: 'edit' });
  // slot 1 filled (img), slot 2 offered as the empty placeholder
  assert.match(html, /<div class="quote-portrait" data-inline-photo="1">/);
  assert.match(html, /class="[^"]*quote-portrait[^"]*is-empty"[^>]*data-inline-photo="2"/s);
});

/**
 * Placeholder consistency (polish round, 2026-07-20). The icon+label inner is
 * one shared helper (`imagePlaceholderInnerHtml`) instead of a per-type copy
 * of the same SVG, and the label follows the presentation language — it used
 * to be hardcoded, and inconsistently: image-text said "Afbeelding" while
 * image-slide said "Image", regardless of deck language.
 */

/** Types that render a labelled placeholder (slot big enough for text). */
const LABELLED_TYPES = ['image-slide', 'image-text-slide', 'gallery-slide'];

/** Every type with an empty image slot, and content that produces one. */
const ALL_PLACEHOLDER_TYPES = [
  ['image-slide', {}],
  ['image-text-slide', {}],
  ['gallery-slide', { images: [{}] }],
  ['content-columns-slide', { columnCount: 2 }],
  ['logo-wall-slide', {}],
  ['quote-slide', { quote: 'Hi' }],
  ['team-cards-slide', { members: [{ name: 'A' }] }],
  ['freeform-slide', { elements: [{ id: 'e1', type: 'image' }] }],
];

test('every empty placeholder carries the shared icon + label inner', () => {
  for (const type of LABELLED_TYPES) {
    const html = SLIDE_TYPES[type].renderHtml({ images: [{}] }, {}, { mode: 'edit' });
    assert.ok(
      html.includes('image-placeholder-inner'),
      `${type}: expected the shared placeholder inner`
    );
    assert.ok(
      html.includes('image-placeholder-icon'),
      `${type}: expected the shared placeholder icon`
    );
  }
});

test('the placeholder label follows the deck language', () => {
  for (const type of LABELLED_TYPES) {
    const nl = SLIDE_TYPES[type].renderHtml({ images: [{}] }, {}, { lang: 'nl' });
    const en = SLIDE_TYPES[type].renderHtml({ images: [{}] }, {}, { lang: 'en-GB' });
    assert.match(nl, /image-placeholder-text">Afbeelding/, `${type}: nl label`);
    assert.match(en, /image-placeholder-text">Image/, `${type}: en label`);
  }
});

test('an unknown language falls back to Dutch, matching getSlideCopy', () => {
  const html = SLIDE_TYPES['image-slide'].renderHtml({}, {}, { lang: 'de' });
  assert.match(html, /image-placeholder-text">Afbeelding/);
});

test('gallery keeps its slot numbering, now localised', () => {
  const def = SLIDE_TYPES['gallery-slide'];
  const nl = def.renderHtml({ images: [{}, {}] }, {}, { lang: 'nl' });
  const labels = [...nl.matchAll(/image-placeholder-text">([^<]*)/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['Afbeelding 1', 'Afbeelding 2']);
});

test('placeholders stay decorative for screen readers', () => {
  // The accessible affordance is the editor's "Add image" chip; the
  // placeholder box itself must not be announced. Gallery used to be the one
  // that forgot this.
  for (const type of LABELLED_TYPES) {
    const html = SLIDE_TYPES[type].renderHtml({ images: [{}] }, {}, { mode: 'edit' });
    const boxes = html.match(/<div class="[^"]*placeholder[^"]* is-empty"[^>]*>/g) || [];
    assert.ok(boxes.length > 0, `${type}: expected an empty placeholder box`);
    for (const box of boxes) {
      assert.ok(box.includes('aria-hidden="true"'), `${type}: placeholder must be aria-hidden: ${box}`);
    }
  }
});

test('a filled slot renders no placeholder at all', () => {
  const gallery = SLIDE_TYPES['gallery-slide'].renderHtml(
    { images: [{ src: '/a.png', alt: 'a' }] },
    {},
    { lang: 'nl' }
  );
  assert.ok(!gallery.includes('image-placeholder-inner'));
  assert.match(gallery, /<img[^>]*src="\/a\.png"/);
});

/**
 * Consolidation (2026-07-20): every empty image slot is one
 * `imagePlaceholderHtml()` box, so they share a base class and the glyph
 * lives in exactly one place. Before this, eight slide types each inlined
 * their own markup and three carried byte-identical copies of the same SVG.
 */

test('every slide type with an image slot renders the shared placeholder box', () => {
  for (const [type, content] of ALL_PLACEHOLDER_TYPES) {
    const html = SLIDE_TYPES[type].renderHtml(content, {}, { mode: 'edit', lang: 'nl' });
    assert.match(
      html,
      /<div class="image-placeholder[^"]*"/,
      `${type}: expected the shared placeholder base class`
    );
    assert.ok(html.includes('image-placeholder-icon'), `${type}: expected the shared glyph`);
  }
});

test('each type keeps its own modifier class for sizing and colour', () => {
  const modifiers = {
    'gallery-slide': 'gallery-image-placeholder',
    'content-columns-slide': 'cc-image-placeholder',
    'logo-wall-slide': 'logo-wall-placeholder',
    'quote-slide': 'quote-portrait',
    'team-cards-slide': 'team-card-photo',
    'freeform-slide': 'freeform-image-placeholder',
  };
  for (const [type, content] of ALL_PLACEHOLDER_TYPES) {
    const modifier = modifiers[type];
    if (!modifier) continue; // image/image-text use the base class itself
    const html = SLIDE_TYPES[type].renderHtml(content, {}, { mode: 'edit', lang: 'nl' });
    assert.ok(html.includes(modifier), `${type}: lost its ${modifier} modifier`);
  }
});

test('small slots are compact and carry no label', () => {
  // A 112px round portrait or a logo cell cannot fit a label; the helper
  // drops it rather than each type remembering to leave it out.
  for (const type of ['quote-slide', 'team-cards-slide', 'freeform-slide']) {
    const content = ALL_PLACEHOLDER_TYPES.find(([t]) => t === type)[1];
    const html = SLIDE_TYPES[type].renderHtml(content, {}, { mode: 'edit', lang: 'nl' });
    assert.ok(html.includes('is-compact'), `${type}: expected the compact modifier`);
    assert.ok(
      !html.includes('image-placeholder-text'),
      `${type}: a compact placeholder must not render a label`
    );
  }
});

test('the logo-wall label is localised, not hardcoded', () => {
  const def = SLIDE_TYPES['logo-wall-slide'];
  assert.match(def.renderHtml({}, {}, { mode: 'edit', lang: 'nl' }), /image-placeholder-text">Logo/);
  assert.match(def.renderHtml({}, {}, { mode: 'edit', lang: 'en-GB' }), /image-placeholder-text">Logo/);
});

test('content-columns placeholders are labelled and follow the language', () => {
  const def = SLIDE_TYPES['content-columns-slide'];
  const content = { columnCount: 2 };
  assert.match(def.renderHtml(content, {}, { mode: 'edit', lang: 'nl' }), /image-placeholder-text">Afbeelding/);
  assert.match(def.renderHtml(content, {}, { mode: 'edit', lang: 'en-GB' }), /image-placeholder-text">Image/);
});

test('the placeholder glyph is defined in exactly one place', () => {
  // A duplicated SVG is how the label drifted (Afbeelding vs Image) in the
  // first place, so the helper owning it is the thing worth pinning.
  const boxes = SLIDE_TYPES['gallery-slide']
    .renderHtml({ images: [{}, {}] }, {}, { mode: 'edit', lang: 'nl' })
    .match(/image-placeholder-icon/g);
  assert.equal(boxes.length, 2, 'one glyph per empty slot, from the shared helper');
});
