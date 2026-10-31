/**
 * The embed player's boot payload carries the versions the deck has
 * (B182/D72 #6).
 *
 * The route-level language switch of the live `/p/…` page and `/embed/…`
 * player was pinned here until T1.5; both now serve an edition, whose switch
 * is written by the render entry from the edition's own versions and pinned by
 * the renderer-bundle tests. What stays is the embed template's boot payload,
 * for as long as `server/utils/embed-html/` exists.
 *
 * Run with: node --test tests/viewer-language-switch.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { renderEmbedHtmlDocument } =
  await import('../server/utils/embed-html/template.js');

/**
 * The boot payload the embed's inlined runtime reads.
 *
 * Parsed exactly as the runtime parses it — `JSON.parse` on the block's raw
 * text — because that is the assertion. The payload used to be HTML-escaped,
 * and a `<script>` block is raw text where entities are never decoded, so
 * `JSON.parse('{&quot;lang&quot;…')` threw on every embed ever served and the
 * runtime fell back to its defaults for all of it.
 */
function embedBoot(html) {
  const m = html.match(
    /<script id="boot" type="application\/json">([\s\S]*?)<\/script>/,
  );
  assert.ok(m, 'the embed carries a boot payload');
  return JSON.parse(m[1]);
}

test('the embed boot payload is JSON its own runtime can parse', () => {
  // Not about languages as such — but the language switch is one of the four
  // things the runtime silently lost while this was broken (with the slide
  // count, the start index and the allowed-origin list), so it is pinned here
  // beside the switch that depends on it.
  const html = renderEmbedHtmlDocument({
    totalSlides: 3,
    boot: {
      publishId: 'abcd1234',
      totalSlides: 3,
      options: { langSwitch: true },
      lang: 'nl',
      versionLangs: ['nl', 'de'],
    },
  });
  const boot = embedBoot(html);
  assert.equal(boot.totalSlides, 3);
  assert.deepEqual(boot.versionLangs, ['nl', 'de']);
  assert.equal(boot.options.langSwitch, true);
});
