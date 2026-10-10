/**
 * The Bunny player's colors come from the theme, not from a fork (B648).
 *
 * `BUNNY_PLAYER_COLORS` put one fork's two brand hexes in the embed URL that
 * every instance builds, so a Deckyard with its own theme played its videos in
 * someone else's colors — and the accent among them was the stale value B640
 * took out of the slide CSS.
 *
 * Pinned here: the mapping from theme token to player parameter, that a theme
 * naming no usable color leaves Bunny its own default rather than a guess, the
 * two colors reaching the rendered iframe, and that neither brand hex survives
 * anywhere under `shared/`.
 *
 * Run with: node --test tests/bunny-player-colors.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bunnyPlayerColors } from '../shared/slide-types/types/video-slide/player-colors.js';
import videoSlide from '../shared/slide-types/types/video-slide.js';

const SHARED = fileURLToPath(new URL('../shared/', import.meta.url));

/** A theme as `ctx.theme` carries it: the built `cssVars` map. */
const theme = (vars) => ({ cssVars: vars });

const BUNNY_UUID = '3045cc09-0000-4000-8000-00000000abcd';

/** The iframe src the type renders for a Bunny video under `theme`. */
function renderedSrc(themeArg) {
  const html = videoSlide.renderHtml(
    { source: BUNNY_UUID, bunnyLibraryId: '366590' },
    { id: 's1' },
    { theme: themeArg },
  );
  const m = html.match(/<iframe[^>]*\ssrc="([^"]+)"/);
  assert.ok(m, 'the type renders an iframe with a src');
  return m[1].replace(/&amp;/g, '&');
}

// ------------------------------------------------------------- the mapping

test('the controls take the accent the theme drew for a dark ground', () => {
  // The player sits on the video, so `accent-on-dark` is the one made for it.
  const colors = bunnyPlayerColors(
    theme({
      '--t-color-accent': '#254d38',
      '--t-color-accent-on-dark': '#dba323',
    }),
  );
  assert.deepEqual(colors, {
    primaryColor: 'dba323',
    controlsColor: 'dba323',
    accentColor: '254d38',
  });
});

test('without an on-dark accent the plain accent carries the controls too', () => {
  const colors = bunnyPlayerColors(theme({ '--t-color-accent': '#254d38' }));
  assert.deepEqual(colors, {
    primaryColor: '254d38',
    controlsColor: '254d38',
    accentColor: '254d38',
  });
});

test('a short hex is expanded, and the `#` is dropped', () => {
  const colors = bunnyPlayerColors(theme({ '--t-color-accent': '#0a0' }));
  assert.equal(colors.accentColor, '00aa00');
});

// ------------------------------------------- what a theme that says nothing gets

test('no theme means no parameter, so Bunny keeps its own default', () => {
  assert.deepEqual(bunnyPlayerColors(null), {});
  assert.deepEqual(bunnyPlayerColors(undefined), {});
  assert.deepEqual(bunnyPlayerColors({}), {});
  assert.deepEqual(bunnyPlayerColors(theme({})), {});
});

test('a token that is not a hex colour yields no parameter rather than a guess', () => {
  // Core has no brand colour to put in its place, so the honest answer is none.
  assert.deepEqual(
    bunnyPlayerColors(
      theme({
        '--t-color-accent': 'rgba(37, 77, 56, 0.9)',
        '--t-color-accent-on-dark': 'var(--something-else)',
      }),
    ),
    {},
  );
});

// ------------------------------------------------------------- through the type

test('the rendered embed carries the theme colours', () => {
  const src = renderedSrc(
    theme({
      '--t-color-accent': '#254d38',
      '--t-color-accent-on-dark': '#dba323',
    }),
  );
  assert.match(src, /[?&]primaryColor=dba323(&|$)/);
  assert.match(src, /[?&]controlsColor=dba323(&|$)/);
  assert.match(src, /[?&]accentColor=254d38(&|$)/);
});

test('the rendered embed of an unthemed deck names no colour at all', () => {
  const src = renderedSrc(null);
  assert.equal(new URL(src).hostname, 'iframe.mediadelivery.net');
  const params = new URL(src).searchParams;
  for (const param of ['primaryColor', 'controlsColor', 'accentColor']) {
    assert.equal(params.has(param), false, `${param} is absent`);
  }
});

// ------------------------------------------------------------- the guard

test('neither brand hex survives anywhere under shared/', () => {
  // Spelled in halves so this file is not itself a hit.
  const banned = ['db' + 'ff00', '37' + '5c5d'];
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.js') && !name.endsWith('.json')) continue;
      const text = readFileSync(full, 'utf8').toLowerCase();
      for (const hex of banned) {
        if (text.includes(hex)) offenders.push(`${full}: ${hex}`);
      }
    }
  };
  walk(SHARED);
  assert.deepEqual(
    offenders,
    [],
    `a fork's brand colour belongs in a theme, not in shared/:\n${offenders.join('\n')}`,
  );
});
