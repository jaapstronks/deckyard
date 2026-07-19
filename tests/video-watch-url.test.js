import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveVideoWatchUrl, videoPdfCopy } from '../server/export/video-watch-url.js';

/**
 * The PDF video-slide placeholder resolves a "watch online" URL server-side.
 * Ladder: published deck deep-link → provider URL → none. (2026-07-18 decision.)
 */

const youtubeSlide = (autoplay = 'off') => ({
  id: 'v1',
  type: 'video-slide',
  content: { source: 'https://youtu.be/dQw4w9WgXcQ', autoplay },
});

test('published deck wins: deep-links to the slide by index', () => {
  const pres = { published: { id: 'ab12', slug: 'mijn-deck' } };
  const { url, kind } = resolveVideoWatchUrl(youtubeSlide(), pres, {
    baseUrl: 'https://slides.ciiic.nl',
    slideIndex: 6,
  });
  assert.equal(kind, 'deck');
  assert.equal(url, 'https://slides.ciiic.nl/p/ab12-mijn-deck#slide=6');
});

test('trailing slash on baseUrl is normalised', () => {
  const pres = { published: { id: 'ab12', slug: 'x' } };
  const { url } = resolveVideoWatchUrl(youtubeSlide(), pres, {
    baseUrl: 'https://slides.ciiic.nl/',
    slideIndex: 0,
  });
  assert.equal(url, 'https://slides.ciiic.nl/p/ab12-x#slide=0');
});

test('published but no base URL falls through to the provider URL', () => {
  const pres = { published: { id: 'ab12', slug: 'x' } };
  const { url, kind } = resolveVideoWatchUrl(youtubeSlide(), pres, {
    baseUrl: '',
    slideIndex: 3,
  });
  assert.equal(kind, 'provider');
  assert.equal(url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('unpublished deck falls back to the YouTube watch URL', () => {
  const { url, kind } = resolveVideoWatchUrl(youtubeSlide(), {}, {
    baseUrl: 'https://slides.ciiic.nl',
  });
  assert.equal(kind, 'provider');
  assert.equal(url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('autoplay on appends the provider autoplay param', () => {
  const { url } = resolveVideoWatchUrl(youtubeSlide('on'), {}, {});
  assert.equal(url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1');
});

test('vimeo provider URL (no autoplay uses the canonical page)', () => {
  const slide = { id: 'v', content: { source: 'https://vimeo.com/123456789' } };
  const { url, kind } = resolveVideoWatchUrl(slide, {}, {});
  assert.equal(kind, 'provider');
  assert.equal(url, 'https://vimeo.com/123456789');
});

test('vimeo autoplay uses the player URL', () => {
  const slide = {
    id: 'v',
    content: { source: 'https://vimeo.com/123456789', autoplay: 'on' },
  };
  const { url } = resolveVideoWatchUrl(slide, {}, {});
  assert.equal(url, 'https://player.vimeo.com/video/123456789?autoplay=1');
});

test('bunny UUID resolves to the mediadelivery play URL with library id', () => {
  const slide = {
    id: 'v',
    content: {
      source: '3045cc09-605c-40d9-aa76-9ace93e7f637',
      bunnyLibraryId: '366590',
    },
  };
  const { url, kind } = resolveVideoWatchUrl(slide, {}, {});
  assert.equal(kind, 'provider');
  assert.equal(
    url,
    'https://iframe.mediadelivery.net/play/366590/3045cc09-605c-40d9-aa76-9ace93e7f637'
  );
});

test('no source and no publish state resolves to nothing', () => {
  const slide = { id: 'v', content: { source: '' } };
  const { url, kind } = resolveVideoWatchUrl(slide, {}, {});
  assert.equal(url, null);
  assert.equal(kind, null);
});

test('unresolvable source (not a known provider) resolves to nothing', () => {
  const slide = { id: 'v', content: { source: 'just some text' } };
  const { url, kind } = resolveVideoWatchUrl(slide, {}, {});
  assert.equal(url, null);
  assert.equal(kind, null);
});

test('copy falls back to nl for unknown languages, en-GB is distinct', () => {
  assert.equal(videoPdfCopy('nl').kicker, 'Videoslide');
  assert.equal(videoPdfCopy('en-GB').kicker, 'Video slide');
  assert.equal(videoPdfCopy('ar').kicker, videoPdfCopy('nl').kicker);
});
