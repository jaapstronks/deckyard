/**
 * B186 L1: the SPA shell's link preview (Open Graph + Twitter tags) follows
 * the branding knobs, so a fork's shared `/app/…` link no longer unfurls with
 * the Deckyard card. With every knob unset the shell is byte-identical to
 * `client/index.html`. Covers `injectLinkPreview` in
 * server/routes/static/app-shell.js and `getOgImageUrl` / `getOgDescription`
 * in server/config/branding.js.
 *
 * Run with: node --test tests/shell-link-preview.test.js
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  injectLinkPreview,
  readIndexHtml,
} from '../server/routes/static/app-shell.js';
import {
  getOgImageUrl,
  getOgDescription,
  brandingConfigWarnings,
} from '../server/config/branding.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..', 'client');
const KEYS = ['APP_NAME', 'OG_IMAGE_URL', 'OG_DESCRIPTION'];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** The content of every og:/twitter: meta in the head, keyed by name. */
function previewTags(html) {
  const tags = {};
  const re =
    /<meta\s+(?:property|name)="((?:og|twitter):[^"]+)"\s+content="([^"]*)"/g;
  for (const m of html.matchAll(re)) tags[m[1]] = m[2];
  return tags;
}

test('with no knobs set the shell is byte-identical to client/index.html', async () => {
  const raw = await readIndexHtml(clientDir);
  assert.equal(injectLinkPreview(raw), raw);
});

test('every preview tag the shell carries is rewritten exactly once', async () => {
  const raw = await readIndexHtml(clientDir);
  for (const key of [
    'og:site_name',
    'og:title',
    'og:description',
    'og:image',
    'twitter:title',
    'twitter:description',
    'twitter:image',
  ]) {
    const re = new RegExp(`(?:property|name)="${key}"`, 'g');
    assert.equal(raw.match(re)?.length, 1, key);
  }
});

test('with the knobs set no Deckyard asset or text is left in the preview', async () => {
  process.env.APP_NAME = 'Acme Slides';
  process.env.OG_IMAGE_URL = '/custom/assets/images/acme-card.png';
  process.env.OG_DESCRIPTION = 'Decks by Acme.';
  const tags = previewTags(injectLinkPreview(await readIndexHtml(clientDir)));
  assert.deepEqual(tags, {
    'og:type': 'website',
    'og:site_name': 'Acme Slides',
    'og:title': 'Acme Slides',
    'og:description': 'Decks by Acme.',
    'og:image': '/custom/assets/images/acme-card.png',
    'twitter:card': 'summary_large_image',
    'twitter:title': 'Acme Slides',
    'twitter:description': 'Decks by Acme.',
    'twitter:image': '/custom/assets/images/acme-card.png',
  });
  for (const value of Object.values(tags)) {
    assert.doesNotMatch(value, /deckyard|slides-previewimage/i);
  }
});

test('values are escaped and a $ is text, not a replacement pattern', () => {
  process.env.OG_DESCRIPTION = `A&B "quoted" $& $1`;
  const html = injectLinkPreview(
    '<meta\n      property="og:description"\n      content="old"\n    />',
  );
  assert.equal(
    html,
    '<meta\n      property="og:description"\n      content="A&amp;B &quot;quoted&quot; $&amp; $1"\n    />',
  );
});

test('OG_IMAGE_URL takes an absolute or root-relative URL, else the default', () => {
  process.env.OG_IMAGE_URL = 'https://cdn.example.com/card.png';
  assert.equal(getOgImageUrl(), 'https://cdn.example.com/card.png');
  process.env.OG_IMAGE_URL = '//cdn.example.com/card.png';
  assert.equal(getOgImageUrl(), '/assets/images/slides-previewimage.png');
  assert.match(brandingConfigWarnings().join('\n'), /OG_IMAGE_URL=/);
  process.env.OG_IMAGE_URL = '   ';
  assert.equal(getOgImageUrl(), '/assets/images/slides-previewimage.png');
  assert.deepEqual(brandingConfigWarnings(), []);
});

test('OG_DESCRIPTION is trimmed and falls back to the Deckyard line', () => {
  assert.match(getOgDescription(), /^Create and present professional slides/);
  process.env.OG_DESCRIPTION = '  Decks by Acme.  ';
  assert.equal(getOgDescription(), 'Decks by Acme.');
});
