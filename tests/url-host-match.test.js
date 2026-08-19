/**
 * Host allow-lists match hosts, not substrings.
 *
 * Every provider allow-list used to be `hostname.endsWith('youtube.com')`,
 * which `notyoutube.com` and `youtube.com.attacker.tld` both satisfy — 22 of
 * the 41 CodeQL alerts triaged in B100 were instances of exactly that. The
 * single `hostMatches()` helper is now the one spelling; this file pins both
 * the helper and the four surfaces that call it, so a re-introduced
 * `endsWith()` fails here rather than in a security scan months later.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { hostMatches, hostMatchesAny } from '../shared/url-host.js';
import { detectStreamProvider } from '../shared/video-stream-providers.js';
import {
  youtubeEmbedUrl,
  vimeoEmbedUrl,
} from '../shared/slide-types/helpers.js';
import { parseVideoSource } from '../server/export/video-helpers.js';
import { extractPageId } from '../server/utils/notion/parser.js';

test('hostMatches accepts the domain itself and its subdomains', () => {
  assert.equal(hostMatches('youtube.com', 'youtube.com'), true);
  assert.equal(hostMatches('www.youtube.com', 'youtube.com'), true);
  assert.equal(hostMatches('a.b.youtube.com', 'youtube.com'), true);
  // Case and the DNS root dot are normalised away.
  assert.equal(hostMatches('WWW.YouTube.com.', 'youtube.com'), true);
});

test('hostMatches rejects the substring bypasses', () => {
  assert.equal(hostMatches('notyoutube.com', 'youtube.com'), false);
  assert.equal(hostMatches('youtube.com.attacker.tld', 'youtube.com'), false);
  assert.equal(hostMatches('xyoutube.com', 'youtube.com'), false);
  assert.equal(hostMatches('', 'youtube.com'), false);
  assert.equal(hostMatches('youtube.com', ''), false);
  // A subdomain is not a match for the *other* direction.
  assert.equal(hostMatches('youtube.com', 'www.youtube.com'), false);
});

test('hostMatchesAny needs one hit and tolerates a non-list', () => {
  assert.equal(hostMatchesAny('player.vimeo.com', ['vimeo.com']), true);
  assert.equal(hostMatchesAny('evilvimeo.com', ['vimeo.com']), false);
  assert.equal(hostMatchesAny('vimeo.com', []), false);
  assert.equal(hostMatchesAny('vimeo.com', null), false);
});

test('detectStreamProvider only matches the real provider hosts', () => {
  assert.equal(
    detectStreamProvider('https://www.youtube.com/watch?v=abc'),
    'youtube',
  );
  assert.equal(detectStreamProvider('https://youtu.be/abc'), 'youtube');
  assert.equal(
    detectStreamProvider('https://player.vimeo.com/video/1'),
    'vimeo',
  );
  assert.equal(
    detectStreamProvider('https://iframe.mediadelivery.net/play/1/2'),
    'bunny',
  );
  assert.equal(
    detectStreamProvider('https://customer-x.cloudflarestream.com/a/iframe'),
    'cloudflare',
  );

  for (const bypass of [
    'https://notyoutube.com/watch?v=abc',
    'https://youtube.com.attacker.tld/watch?v=abc',
    'https://evilvimeo.com/video/1',
    'https://notmediadelivery.net/play/1/2',
    'https://fakemux.com/x',
    'https://notvideodelivery.net/a',
  ]) {
    assert.equal(detectStreamProvider(bypass), null, bypass);
  }
});

test('the embed URL builders refuse look-alike hosts', () => {
  assert.match(
    youtubeEmbedUrl('https://www.youtube.com/watch?v=abc'),
    /youtube-nocookie\.com\/embed\/abc/,
  );
  assert.equal(youtubeEmbedUrl('https://notyoutube.com/watch?v=abc'), '');
  assert.equal(
    youtubeEmbedUrl('https://youtube.com.attacker.tld/watch?v=abc'),
    '',
  );

  assert.match(vimeoEmbedUrl('https://vimeo.com/12345'), /player\.vimeo\.com/);
  assert.equal(vimeoEmbedUrl('https://evilvimeo.com/12345'), '');
});

test('the PPTX export video parser refuses look-alike hosts', () => {
  assert.equal(
    parseVideoSource('https://www.youtube.com/watch?v=abc').provider,
    'youtube',
  );
  assert.equal(
    parseVideoSource('https://player.vimeo.com/video/12345').provider,
    'vimeo',
  );
  assert.equal(
    parseVideoSource('https://notyoutube.com/watch?v=abc').provider,
    null,
  );
  assert.equal(
    parseVideoSource('https://evilvimeo.com/video/12345').provider,
    null,
  );
});

test('the Notion page-id extractor refuses look-alike hosts', () => {
  const id = 'a'.repeat(32);
  assert.equal(extractPageId(`https://www.notion.so/Page-${id}`), id);
  assert.equal(extractPageId(`https://team.notion.site/Page-${id}`), id);
  assert.equal(extractPageId(`https://notnotion.so/Page-${id}`), null);
  assert.equal(
    extractPageId(`https://notion.so.attacker.tld/Page-${id}`),
    null,
  );
});
