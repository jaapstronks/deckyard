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
  assert.match(html, /team-card-photo is-empty[^>]*data-inline-photo="0"/s);
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
  assert.match(editHtml, /quote-portrait is-empty[^>]*data-inline-photo="1"/s);

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
  assert.match(html, /quote-portrait is-empty[^>]*data-inline-photo="2"/s);
});
