/**
 * The presenter topbar is one row, and it has one rule for how that row gives
 * way when it is tight (B324): the controls keep their own width, only the two
 * texts (deck title, shortcut hint) yield, by truncating.
 *
 * The defect this pins: every item in `.presenter-actions` could shrink, and
 * a flex item squeezed below its content wraps it. The NL/EN language switch
 * (a `.sb-segmented`, which wraps by design for form columns) stacked its two
 * buttons and fell out of the 56px bar on 1760px with the Dutch labels.
 *
 * There is no browser in `npm test`, so this reads the rule off the
 * stylesheet. The geometry itself was checked in the browser at 1280px and
 * 1760px, NL and EN UI, with a long deck title (PR for B324).
 *
 * Run with: node --test tests/presenter-topbar-layout.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const cssPath = path.join(
  repoRoot,
  'client/styles/slides/03-components/50-presenter-layout.css',
);

/** Declarations of every rule whose selector list is exactly `selector`. */
function declarationsOf(css, selector) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped))) {
    if (m[1].trim() !== selector) continue;
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i < 0) continue;
      out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

describe('presenter topbar: one row, the texts yield (B324)', async () => {
  const css = await fs.readFile(cssPath, 'utf8');

  it('the controls in the actions row do not shrink', () => {
    assert.equal(
      declarationsOf(css, '.presenter-actions > *')['flex-shrink'],
      '0',
    );
  });

  it('the language switch keeps its buttons on one row, at its own width', () => {
    const seg = declarationsOf(css, '.presenter-lang-seg');
    assert.equal(seg['flex-wrap'], 'nowrap');
    assert.equal(seg.width, undefined, 'no fixed width on the switch');
  });

  it('the actions row can yield, and the hint is what absorbs it', () => {
    const actions = declarationsOf(css, '.presenter-actions');
    assert.equal(actions['min-width'], '0');
    const help = declarationsOf(css, '.presenter-actions > .presenter-help');
    assert.equal(help['flex-shrink'], '1');
    assert.equal(help['min-width'], '0');
    assert.equal(help['text-overflow'], 'ellipsis');
  });

  it('the deck title truncates instead of pushing the controls', () => {
    const title = declarationsOf(css, '.presenter-title');
    assert.equal(title['min-width'], '0');
    assert.equal(title['white-space'], 'nowrap');
    assert.equal(title['text-overflow'], 'ellipsis');
  });
});
