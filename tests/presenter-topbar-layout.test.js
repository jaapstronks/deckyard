/**
 * The presenter topbar has one rule for how it gives way when it is tight
 * (B324, B506): the controls keep their own width, the two texts (deck title,
 * shortcut hint) yield first by truncating, and when the controls alone do not
 * fit, whole controls wrap onto a second row. The bar grows with them and the
 * slide stage fits whatever is left, so nothing is pushed past the viewport.
 *
 * The defect this pins: every item in `.presenter-actions` could shrink, and
 * a flex item squeezed below its content wraps it. The NL/EN language switch
 * (a `.sb-segmented`, which wraps by design for form columns) stacked its two
 * buttons and fell out of the 56px bar on 1760px with the Dutch labels.
 *
 * The second defect (B506): with the poll controls and the console toggle in
 * the row, the controls alone were wider than 1760px. A row that could not
 * wrap ran past the right edge, widened the shell, and pushed the console rail
 * (timer, Reset, target, next slide, notes) half out of the viewport. The
 * stage sizing subtracted a fixed 56px bar height, so letting the bar grow
 * needed the stage to fit its container instead.
 *
 * There is no browser in `npm test`, so this reads the rule off the
 * stylesheet. The geometry is checked where a browser does run: the
 * `presenter-view-{en,nl}` capture recipes refuse to shoot at 1760×1100 when
 * the page is wider than the viewport or the console rail is cut off
 * (`capture/recipes/_features-shots.js`).
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
const viewerDir = path.join(repoRoot, 'client/styles/viewer');
const cssPath = path.join(viewerDir, '50-presenter-layout.css');

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

describe('presenter topbar: the texts yield, then the controls wrap (B324, B506)', async () => {
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

  it('the controls wrap onto a second row instead of running off the edge', () => {
    const actions = declarationsOf(css, '.presenter-actions');
    assert.equal(actions['flex-wrap'], 'wrap');
    const top = declarationsOf(css, '.presenter-topbar');
    assert.equal(
      top['min-height'],
      'var(--presenter-topbar-height)',
      'one row is the minimum height, not a fixed one',
    );
    assert.equal(top.height, undefined);
  });
});

describe('presenter shell: the bar sizes its row, the stage fits the rest (B506)', async () => {
  const css = await fs.readFile(cssPath, 'utf8');

  it('the top bar row follows its content and the column cannot widen the shell', () => {
    const shell = declarationsOf(css, '.presenter-shell');
    assert.match(shell['grid-template-rows'], /^auto minmax\(0, 1fr\) /);
    assert.equal(shell['grid-template-columns'], 'minmax(0, 1fr)');
  });

  it('the shell owns both chrome-row constants; the slide theme layer sets no :root', () => {
    // B531 / D268: the top bar height is a presenter constant, not theme
    // input. It used to ride along in the old theme layer under `:root`; now the shell
    // declares it next to the progress height, so ui=min and fullscreen zero
    // both on one selector.
    const shell = declarationsOf(css, '.presenter-shell');
    assert.equal(shell['--presenter-topbar-height'], '56px');
    assert.equal(shell['--presenter-progress-height'], '56px');
  });

  it('the stage fits the deck box, not the viewport minus a bar constant', () => {
    assert.equal(declarationsOf(css, '.deck')['container-type'], 'size');
    const stage = declarationsOf(css, '.deck-stage');
    assert.equal(stage.width, 'min(100cqw, 100cqh * 16 / 9)');
    assert.equal(stage.height, 'min(100cqh, 100cqw * 9 / 16)');
  });

  it('no other host carries a second copy of the stage math', async () => {
    for (const file of ['51-presenter-console.css', '53-present-window.css']) {
      const other = await fs.readFile(path.join(viewerDir, file), 'utf8');
      const stripped = other.replace(/\/\*[\s\S]*?\*\//g, '');
      assert.doesNotMatch(
        stripped,
        /\.deck-stage\s*\{/,
        `${file} sizes .deck-stage itself`,
      );
      assert.doesNotMatch(stripped, /--presenter-topbar-height/, file);
    }
  });
});
