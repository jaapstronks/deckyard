/**
 * The share dialog holds one height while it fills itself in (B220).
 *
 * `openShareModal()` shows the dialog and *then* fetches: collaborators and
 * share links both land after `show()`. While the box was content-driven it
 * grew 621 → 726 px as they arrived and lifted the tab strip 53 px — more
 * than the height of the button being aimed at, so a click meant for "Link"
 * landed beside it. Switching tabs moved the strip too: measured at 1440×900
 * it sat at 179 px on Workspace, 198 px on Link and 372 px on Publish. The
 * same reflow is why the capture recipe missed its tab (A9.9).
 *
 * The fix is one declaration — `max-height` became `height` — so this pins the
 * mechanism in the stylesheet rather than the symptom on screen. A layout
 * assertion is not available here: the suite runs on jsdom, which does no
 * layout at all and returns zeroes from `getBoundingClientRect()`, so
 * comparing the strip's `top` before and after the loads would pass on the
 * broken stylesheet just as happily. The measurements above were taken in a
 * real browser and are recorded in the CSS comment beside the rule.
 *
 * Four checks, each naming a way the height could start moving again:
 *  1. `.share-modal` sizes with `height`, never `max-height`
 *  2. that height stays viewport-bounded, so a short screen is not overflowed
 *  3. the dialog clips, so a tall child cannot push the box open
 *  4. the scroll chain under it survives — `min-height: 0` on both the content
 *     region and the body, and the body still scrolls
 *
 * Run with: node --test tests/share-modal-stable-height.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const SHARE_CSS = path.join(
  repoRoot,
  'client/styles/base/04-editor-and-misc/12-modals-share.css',
);

/**
 * Blank out `/* … *\/` comments so the prose beside a rule cannot satisfy a
 * check — the comment above `.share-modal` quotes `max-height` by name.
 *
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * The declarations inside one top-level rule, by selector.
 *
 * @param {string} css - Stylesheet with comments already stripped
 * @param {string} selector - Exact selector text, as written
 * @returns {string} The rule body, without the braces
 */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(^|})\\s*${escaped}\\s*{([^}]*)}`, 'm'));
  assert.ok(match, `no rule found for \`${selector}\``);
  return match[2];
}

const css = stripComments(await fs.readFile(SHARE_CSS, 'utf8'));

describe('share dialog height', () => {
  const modal = ruleBody(css, '.share-modal');

  it('sizes with height, not max-height', () => {
    assert.match(
      modal,
      /(^|;)\s*height:/,
      '`.share-modal` must declare a `height`; a content-driven box moves the tab strip while the dialog loads (B220)',
    );
    assert.doesNotMatch(
      modal,
      /(^|;)\s*max-height:/,
      '`.share-modal` must not cap with `max-height`: that lets the box grow with its content, which is the B220 reflow',
    );
  });

  it('keeps that height inside the viewport', () => {
    assert.match(
      modal,
      /height:\s*min\([^)]*\d+vh[^)]*\)/,
      '`.share-modal` height must stay viewport-bounded (a `min()` with a `vh` term), or a short screen loses the bottom of the dialog',
    );
  });

  it('clips, so a tall child cannot push it open', () => {
    assert.match(modal, /overflow:\s*hidden/, '`.share-modal` must clip');
  });
});

describe('share dialog scroll chain', () => {
  it('lets the content region shrink inside the fixed height', () => {
    const content = ruleBody(css, '.modal.share-modal > .modal-content');
    assert.match(
      content,
      /min-height:\s*0/,
      'the content region needs `min-height: 0`, or the flex child refuses to shrink and the footer leaves the screen',
    );
  });

  it('scrolls in the body, not by growing the dialog', () => {
    const body = ruleBody(css, '.share-modal-body');
    assert.match(body, /min-height:\s*0/, '`.share-modal-body` needs `min-height: 0`');
    assert.match(
      body,
      /overflow-y:\s*auto/,
      '`.share-modal-body` must be the scrolling region: with a fixed dialog height it is the only place overflow can go',
    );
  });
});
