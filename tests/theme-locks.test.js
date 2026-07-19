/**
 * Tests for theme override locks.
 *
 * A locked brand property must win in two places at once: the editor stops
 * offering the control, and the renderer ignores an override a slide already
 * carries — otherwise a deck authored before the lock leaks past the branding.
 * Enforcement is non-destructive, so unlocking restores every slide's own
 * value; these tests pin both halves of that contract.
 *
 * Run with: node --test tests/theme-locks.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getLockPolicy,
  isLocked,
  applyLocksToContent,
  LOCKABLE_PROPERTIES,
  LOCKED_CONTENT_KEYS,
} from '../shared/theme-locks.js';
import { renderSlideHtml } from '../shared/slide-types.js';

const lockedBg = { id: 't', locks: { background: 'locked' } };
const lockedLogo = { id: 't', locks: { logo: 'locked' } };
const openTheme = { id: 't', locks: { background: 'open', logo: 'open' } };

test('every property defaults to open', () => {
  assert.deepEqual(getLockPolicy(undefined), { background: 'open', logo: 'open' });
  assert.deepEqual(getLockPolicy({}), { background: 'open', logo: 'open' });
  assert.deepEqual(getLockPolicy({ locks: 'nonsense' }), {
    background: 'open',
    logo: 'open',
  });
});

test('an unknown lock mode reads as open, never as locked', () => {
  // Fail open: a typo in a theme must not silently strip every slide.
  assert.equal(isLocked({ locks: { background: 'LOCKED' } }, 'background'), false);
  assert.equal(isLocked({ locks: { background: true } }, 'background'), false);
  assert.equal(isLocked({ locks: { background: 'locked' } }, 'background'), true);
});

test('a missing theme locks nothing', () => {
  // A render path that forgets to pass the theme must degrade to today's
  // behaviour, not to a stripped slide.
  assert.equal(isLocked(null, 'background'), false);
  assert.equal(isLocked(undefined, 'background'), false);
  const content = { background: 'dark', slideLogo: 'top-right' };
  assert.equal(applyLocksToContent(content, null), content);
});

test('an unlockable property is never locked', () => {
  assert.equal(isLocked({ locks: { shadow: 'locked' } }, 'shadow'), false);
  assert.equal(isLocked({ locks: { imageRadius: 'locked' } }, 'imageRadius'), false);
});

test('an open theme returns the very same content object', () => {
  // No allocation on the common path — this runs for every slide render.
  const content = { background: 'dark' };
  assert.equal(applyLocksToContent(content, openTheme), content);
});

test('a locked background strips the whole background group', () => {
  const content = {
    title: 'Keep me',
    background: 'dark',
    bgCustomColor: '#ff0000',
    bgImage: '/a.jpg',
    slideBgImage: '/b.jpg',
    slideBgFit: 'cover',
    slideBgFocusX: 20,
    slideBgFocusY: 80,
    slideBgOverlay: 'auto',
    slideBgText: 'light',
    slideBgTextAuto: 'light',
    slideBgNeedsScrim: true,
    slideBgAutoFor: '/b.jpg',
    slideLogo: 'top-right',
  };

  const out = applyLocksToContent(content, lockedBg);

  assert.deepEqual(Object.keys(out), ['title', 'slideLogo']);
  // Non-destructive: the caller's object is untouched.
  assert.equal(content.background, 'dark');
});

test('the locks are independent of each other', () => {
  const content = { background: 'dark', slideLogo: 'top-right', title: 'T' };

  assert.deepEqual(applyLocksToContent(content, lockedLogo), {
    background: 'dark',
    title: 'T',
  });
  assert.deepEqual(applyLocksToContent(content, lockedBg), {
    slideLogo: 'top-right',
    title: 'T',
  });
});

test('every lockable property declares the keys it governs', () => {
  for (const prop of LOCKABLE_PROPERTIES) {
    assert.ok(
      Array.isArray(LOCKED_CONTENT_KEYS[prop]) && LOCKED_CONTENT_KEYS[prop].length,
      `${prop} governs no content keys`
    );
  }
});

test('renderSlideHtml ignores a locked background already on the slide', () => {
  const slide = {
    id: 's',
    type: 'content-slide',
    content: { title: 'Hello', body: '- One', background: 'mist' },
  };

  const open = renderSlideHtml(slide, { theme: openTheme });
  const locked = renderSlideHtml(slide, { theme: lockedBg });

  assert.match(open, /slide-bg-mist/);
  assert.doesNotMatch(locked, /slide-bg-mist/);
  // The slide still renders; only the override is gone.
  assert.match(locked, /Hello/);
});

test('renderSlideHtml drops a locked per-slide background image', () => {
  const slide = {
    id: 's',
    type: 'content-slide',
    content: { title: 'Hello', slideBgImage: '/photo.jpg' },
  };

  assert.match(renderSlideHtml(slide, { theme: openTheme }), /photo\.jpg/);
  assert.doesNotMatch(renderSlideHtml(slide, { theme: lockedBg }), /photo\.jpg/);
});

test('renderSlideHtml without a theme renders every override, as before', () => {
  const slide = {
    id: 's',
    type: 'content-slide',
    content: { title: 'Hello', background: 'mist' },
  };
  assert.match(renderSlideHtml(slide, {}), /slide-bg-mist/);
  assert.match(renderSlideHtml(slide), /slide-bg-mist/);
});

test('unlocking restores the slide, because nothing was written', () => {
  const slide = {
    id: 's',
    type: 'content-slide',
    content: { title: 'Hello', background: 'mist' },
  };

  renderSlideHtml(slide, { theme: lockedBg });
  assert.equal(slide.content.background, 'mist', 'render mutated stored content');
  assert.match(renderSlideHtml(slide, { theme: openTheme }), /slide-bg-mist/);
});
