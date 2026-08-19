import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseOgImage,
  bunnyPullZoneFromPlayPage,
  resolveVideoThumbnailRequest,
  resetBunnyPullZoneCache,
} from '../server/export/video-thumbnail.js';

/**
 * The still behind the play badge in PDF/PNG exports. Two provider quirks are
 * covered here: Bunny's pull zone isn't in the slide (we read it off the play
 * page), and its CDN 403s a request without a referer.
 */

const VIDEO_ID = '3045cc09-605c-40d9-aa76-9ace93e7f637';

const playPage = (imageUrl) =>
  `<html><head><meta property="og:image" content="${imageUrl}"/></head><body></body></html>`;

test('og:image is read in either attribute order', () => {
  assert.equal(
    parseOgImage(
      '<meta property="og:image" content="https://x.b-cdn.net/a.jpg"/>',
    ),
    'https://x.b-cdn.net/a.jpg',
  );
  assert.equal(
    parseOgImage(
      '<meta content="https://x.b-cdn.net/a.jpg" property="og:image">',
    ),
    'https://x.b-cdn.net/a.jpg',
  );
  assert.equal(parseOgImage('<html><head></head></html>'), null);
});

test('the pull zone is taken from a play page that names our video', () => {
  const html = playPage(
    `https://vz-3c68c0d7-c44.b-cdn.net/${VIDEO_ID}/thumbnail.jpg`,
  );
  assert.equal(
    bunnyPullZoneFromPlayPage(html, VIDEO_ID),
    'vz-3c68c0d7-c44.b-cdn.net',
  );
});

test('a play page pointing somewhere else is refused', () => {
  // Not a Bunny CDN host.
  assert.equal(
    bunnyPullZoneFromPlayPage(
      playPage(`https://evil.example/${VIDEO_ID}/thumbnail.jpg`),
      VIDEO_ID,
    ),
    null,
  );
  // Right host, but a different video than we asked for.
  assert.equal(
    bunnyPullZoneFromPlayPage(
      playPage(
        'https://vz-3c68c0d7-c44.b-cdn.net/00000000-0000-4000-8000-000000000000/thumbnail.jpg',
      ),
      VIDEO_ID,
    ),
    null,
  );
  // Plain http is not followed.
  assert.equal(
    bunnyPullZoneFromPlayPage(
      playPage(`http://vz-x.b-cdn.net/${VIDEO_ID}/thumbnail.jpg`),
      VIDEO_ID,
    ),
    null,
  );
  assert.equal(bunnyPullZoneFromPlayPage('<html></html>', VIDEO_ID), null);
});

test('YouTube and Vimeo stills need no referer', async () => {
  const yt = await resolveVideoThumbnailRequest(
    'https://youtu.be/dQw4w9WgXcQ',
    '366590',
  );
  assert.equal(yt.provider, 'youtube');
  assert.equal(yt.url, 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg');
  assert.equal(yt.referer, null);

  const vm = await resolveVideoThumbnailRequest(
    'https://vimeo.com/123456789',
    '366590',
  );
  assert.equal(vm.provider, 'vimeo');
  assert.equal(vm.url, 'https://vumbnail.com/123456789.jpg');
  assert.equal(vm.referer, null);
});

test('a configured pull zone short-circuits discovery, and Bunny gets a referer', async () => {
  const previous = process.env.BUNNY_PULLZONE;
  process.env.BUNNY_PULLZONE = 'vz-configured.b-cdn.net';
  resetBunnyPullZoneCache();
  try {
    const req = await resolveVideoThumbnailRequest(VIDEO_ID, '366590');
    assert.equal(req.provider, 'bunny');
    assert.equal(
      req.url,
      `https://vz-configured.b-cdn.net/${VIDEO_ID}/thumbnail.jpg`,
    );
    // Bunny pull zones ship with hotlink protection on; no referer means 403.
    assert.equal(req.referer, 'https://iframe.mediadelivery.net/');
  } finally {
    if (previous === undefined) delete process.env.BUNNY_PULLZONE;
    else process.env.BUNNY_PULLZONE = previous;
    resetBunnyPullZoneCache();
  }
});

test('an unrecognised source resolves to no thumbnail request', async () => {
  assert.equal(await resolveVideoThumbnailRequest('', '366590'), null);
  assert.equal(
    await resolveVideoThumbnailRequest('not-a-video', '366590'),
    null,
  );
});
