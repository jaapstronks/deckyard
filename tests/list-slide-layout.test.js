/**
 * Tests for list-slide layout + text-size (density) resolution.
 *
 * The renderer resolves text size and column count together against a MEASURED
 * capacity table (see resolveListLayout in shared/slide-types/types/
 * list-slide.js): every cap in it is the largest item count that still cleared
 * the slide's bottom padding edge when the real renderer + real slide CSS were
 * swept in headless Chrome at 1600x900.
 *
 * Two invariants this file exists to protect:
 *
 *  1. Text never spills off the slide. Each cap is asserted at its boundary -
 *     the last count that fits, and the first that does not.
 *  2. An explicitly chosen text size is never silently thrown away. It outranks
 *     the column preference, and the only case that still steps it down (a list
 *     both long and wordy enough to spill across two columns) reports
 *     `steppedDownFrom` so the editor can say so.
 *
 * Run with: node --test tests/list-slide-layout.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { resolveListLayout } from '../shared/slide-types/types/list-slide.js';
import { SLIDE_TYPES } from '../shared/slide-types/registry.js';

function content({ n, density, layout, text = 'Short line', title = 'Item', subheading = '' } = {}) {
  return {
    title: 'List',
    subheading,
    variant: 'numbers',
    density,
    layout,
    items: Array.from({ length: n }, (_, i) => ({ title: `${title} ${i + 1}`, text })),
  };
}

function render(opts) {
  return renderSlideHtml({ type: 'list-slide', content: content(opts) });
}

const resolve = (opts) => resolveListLayout(content(opts));

// Long enough to wrap in a half-width column, and to keep 'auto' off Large.
const LONG_TEXT =
  'A full sentence of real body copy that keeps going for quite a while, well past the wrap point.';
// >60 characters: wraps to a second line even in a full-width column.
const LONG_TITLE = 'A deliberately long item heading that runs past the one-line measure';

const isTwoCol = (html) => /\bis-two-col\b/.test(html) && !/\bis-one-col\b/.test(html);
const isOneCol = (html) => /\bis-one-col\b/.test(html) && !/\bis-two-col\b/.test(html);
const isLarge = (html) => /\bis-comfortable\b/.test(html);
const isSmall = (html) => /\bis-compact\b/.test(html);

describe('list-slide: measured capacity boundaries', () => {
  it('one column at Large holds 4 title+text items, 3 once a subheading takes the room', () => {
    assert.equal(resolve({ n: 4, density: 'comfortable', layout: 'one-column' }).twoCol, false);
    assert.equal(
      resolve({ n: 4, density: 'comfortable', layout: 'one-column', subheading: 'Intro' }).twoCol,
      true,
      'the subheading costs the fourth item its room, so the list moves to two columns'
    );
    assert.equal(resolve({ n: 5, density: 'comfortable', layout: 'one-column' }).twoCol, true);
  });

  it('one column at Large holds 5 title-only items (no description line)', () => {
    assert.equal(resolve({ n: 5, density: 'comfortable', layout: 'one-column', text: '' }).twoCol, false);
    assert.equal(resolve({ n: 6, density: 'comfortable', layout: 'one-column', text: '' }).twoCol, true);
  });

  it('a wrapping item title costs one column at Large two items of capacity', () => {
    assert.equal(
      resolve({ n: 4, density: 'comfortable', layout: 'one-column', title: LONG_TITLE }).twoCol,
      true
    );
    assert.equal(
      resolve({ n: 3, density: 'comfortable', layout: 'one-column', title: LONG_TITLE }).twoCol,
      false
    );
  });

  it('two columns at Large hold 8 short items, 6 wordy ones', () => {
    assert.equal(resolve({ n: 8, density: 'comfortable', layout: 'two-column' }).size, 'comfortable');
    const wordy = resolve({ n: 8, density: 'comfortable', layout: 'two-column', text: LONG_TEXT });
    assert.equal(wordy.size, 'normal', 'eight wordy items do not fit at Large');
    assert.equal(
      resolve({ n: 6, density: 'comfortable', layout: 'two-column', text: LONG_TEXT }).size,
      'comfortable'
    );
  });

  it('two columns at the default and small sizes hold the schema maximum of 8', () => {
    for (const density of ['auto', 'compact']) {
      const r = resolve({ n: 8, density, layout: 'two-column', text: LONG_TEXT, title: LONG_TITLE });
      assert.equal(r.twoCol, true);
      assert.equal(r.steppedDownFrom, null, `${density} never has to step down in two columns`);
    }
  });
});

describe('list-slide: capacity re-measured on the current sizes (A7.9 batch 2.5 tail)', () => {
  // Batch 2.5 nudged the comfortable item-text up a step; re-measuring the wrap
  // points in headless Chrome on the default theme showed a full-width body now
  // wraps past ~60 chars (not "never") and a title past ~55, so the comfortable
  // caps were one to two items too high on wrapping content and overflowed.
  // ~68 chars: wraps to a second line in a full-width column.
  const BODY_2LINE =
    'A line of body copy just long enough to wrap onto a second line here.';

  it('a two-line body drops one-column Large from 4 items to 3', () => {
    // Three such items still fit one column at Large; the fourth no longer does,
    // so it moves to two columns instead of spilling off the slide.
    assert.equal(
      resolve({ n: 3, density: 'comfortable', layout: 'one-column', text: BODY_2LINE }).twoCol,
      false
    );
    assert.equal(
      resolve({ n: 4, density: 'comfortable', layout: 'one-column', text: BODY_2LINE }).twoCol,
      true
    );
  });

  it('a wrapping title with a wrapping body and a subheading drops it to 2', () => {
    const opts = {
      n: 3, density: 'comfortable', layout: 'one-column',
      title: LONG_TITLE, text: BODY_2LINE, subheading: 'Intro',
    };
    assert.equal(resolve(opts).twoCol, true, 'three no longer fit one column at Large');
    assert.equal(resolve({ ...opts, n: 2 }).twoCol, false);
  });

  it('a wrapping title plus a three-line body drops two-column Large from 6 to 4', () => {
    // A half-width column with both a wrapped title and a 3-line body: six of
    // those overflow at Large, four clear the bottom edge.
    assert.equal(
      resolve({ n: 6, density: 'comfortable', layout: 'two-column', title: LONG_TITLE, text: LONG_TEXT }).size,
      'normal'
    );
    assert.equal(
      resolve({ n: 4, density: 'comfortable', layout: 'two-column', title: LONG_TITLE, text: LONG_TEXT }).size,
      'comfortable'
    );
  });
});

describe('list-slide: normal two-column holds 8 except with a subheading + 3-line titles (B54)', () => {
  // Re-measured 2026-08-17 in headless Chrome at 1600×900 (D28 mandate): normal
  // two columns clear the schema maximum of 8 for every shape but one. When a
  // subheading takes a row AND the titles wrap to a third line (past ~79
  // half-width chars), the last item spills ~11px past the bottom padding edge
  // (847 vs 836), and 7 items overflow the same way as 8. So that one
  // combination caps normal two columns at 6, stepping a longer list to compact
  // (which clears 8 of anything). Every other shape still holds 8.
  //
  // 80 chars (the schema maximum, and past the ~79 half-width wrap point), so
  // the item title wraps to a third line.
  const TITLE_3LINE =
    'An item heading long enough to wrap onto a third line in this half-width column!';

  it('steps an 8-item list to compact once a subheading meets 3-line titles', () => {
    const r = resolve({
      n: 8, density: 'auto', layout: 'two-column',
      title: TITLE_3LINE, text: LONG_TEXT, subheading: 'Intro line',
    });
    assert.equal(r.twoCol, true);
    assert.equal(r.size, 'compact', 'normal no longer holds 8 here, so it steps to compact');
  });

  it('still holds 8 at normal without a subheading, even with 3-line titles', () => {
    const r = resolve({
      n: 8, density: 'auto', layout: 'two-column', title: TITLE_3LINE, text: LONG_TEXT,
    });
    assert.equal(r.size, 'normal');
  });

  it('still holds 8 at normal with a subheading when titles stay under three lines', () => {
    // LONG_TITLE wraps to two lines (past 40, under 79), so it is not the case
    // that overflows — the cap must not shrink here.
    const r = resolve({
      n: 8, density: 'auto', layout: 'two-column',
      title: LONG_TITLE, text: LONG_TEXT, subheading: 'Intro line',
    });
    assert.equal(r.size, 'normal');
  });

  it('holds 6 at normal with the subheading + 3-line title, and 7 steps down', () => {
    const opts = {
      density: 'auto', layout: 'two-column',
      title: TITLE_3LINE, text: LONG_TEXT, subheading: 'Intro line',
    };
    assert.equal(resolve({ ...opts, n: 6 }).size, 'normal', 'six still clear the edge');
    assert.equal(resolve({ ...opts, n: 7 }).size, 'compact', 'seven overflow, like eight');
  });
});

describe('list-slide: an explicit text size is not thrown away', () => {
  // The regression this suite was rewritten for: `density: 'comfortable'` used
  // to be dropped outright past 6 items, so a 7-item table of contents of short
  // bullets rendered at the default size in two columns, filling about half the
  // slide, with nothing in the UI saying why.
  it('keeps Large for 7 and 8 short items by moving them into two columns', () => {
    for (const n of [7, 8]) {
      const html = render({ n, density: 'comfortable', layout: 'auto' });
      assert.ok(isLarge(html), `${n} short items keep Large`);
      assert.ok(isTwoCol(html), `${n} short items use two columns`);
      assert.equal(resolve({ n, density: 'comfortable', layout: 'auto' }).steppedDownFrom, null);
    }
  });

  it('changes the column count rather than the size when only one of them can give', () => {
    // Four items at Large do not fit one column once a subheading is present,
    // but they fit two. The size is the promise; the column count is the knob.
    const r = resolve({ n: 4, density: 'comfortable', layout: 'auto', subheading: 'Intro' });
    assert.equal(r.size, 'comfortable');
    assert.equal(r.twoCol, true);
    assert.equal(r.steppedDownFrom, null);
  });

  it('steps the size down only when no column count can hold it, and reports it', () => {
    const opts = { n: 8, density: 'comfortable', layout: 'auto', text: LONG_TEXT, title: LONG_TITLE };
    const r = resolve(opts);
    assert.equal(r.size, 'normal');
    assert.equal(r.steppedDownFrom, 'comfortable', 'the editor needs this to explain the change');
    assert.ok(!isLarge(render(opts)));
  });

  it('honours Small exactly: it always fits, so it never steps anywhere', () => {
    for (const n of [2, 5, 8]) {
      const html = render({ n, density: 'compact', layout: 'auto', text: LONG_TEXT });
      assert.ok(isSmall(html), `${n} items keep Small`);
      assert.equal(resolve({ n, density: 'compact', layout: 'auto', text: LONG_TEXT }).steppedDownFrom, null);
    }
  });
});

describe('list-slide: auto sizing fills the slide', () => {
  it('short lists come out Large wherever Large fits the preferred shape', () => {
    // 5 title+text items are the one gap: they exceed one column's Large
    // capacity (4) but stay under the 6-item mark where two columns become the
    // natural shape, so auto keeps one column at the default size - which
    // measured fuller (~0.88 of the height) than splitting them Large (~0.66).
    for (const n of [2, 3, 4, 6, 7, 8]) {
      assert.ok(isLarge(render({ n, density: 'auto', layout: 'auto' })), `${n} short items render Large`);
    }
    assert.equal(resolve({ n: 5, density: 'auto', layout: 'auto' }).size, 'normal');
    assert.equal(resolve({ n: 5, density: 'auto', layout: 'auto' }).twoCol, false);
    // Without description lines, 5 items do fit one column at Large.
    assert.ok(isLarge(render({ n: 5, density: 'auto', layout: 'auto', text: '' })));
  });

  it('one column is the shape for up to 5 items, two columns beyond', () => {
    assert.ok(isOneCol(render({ n: 4, density: 'auto', layout: 'auto', text: '' })));
    assert.ok(isOneCol(render({ n: 5, density: 'auto', layout: 'auto', text: '' })));
    assert.ok(isTwoCol(render({ n: 6, density: 'auto', layout: 'auto' })));
  });

  it('takes the largest size that fits, not blindly the largest', () => {
    // Four items whose titles wrap: Large holds only 3 of those in one column,
    // so auto stays in one column at the default size rather than splitting a
    // 4-item list across two.
    const r = resolve({ n: 4, density: 'auto', layout: 'auto', title: LONG_TITLE });
    assert.equal(r.size, 'normal');
    assert.equal(r.twoCol, false);
  });

  it('wordy lists keep the default fit instead of being forced Large', () => {
    assert.ok(!isLarge(render({ n: 8, density: 'auto', layout: 'auto', text: LONG_TEXT })));
  });
});

describe('list-slide: fill', () => {
  // Sizing alone did not fix the report: seven short items fit at Large and
  // still left the bottom of the slide empty. `is-fill` grows the rows into the
  // space that is left, and its two gates are what keep that from turning a
  // short or wordy list into a few half-slide bands.
  const isFill = (html) => /\bis-fill\b/.test(html);

  it('fills from three rows per column up', () => {
    assert.ok(isFill(render({ n: 3, density: 'auto', layout: 'one-column' })), '3 rows, one column');
    assert.ok(isFill(render({ n: 6, density: 'auto', layout: 'two-column' })), '3 rows per column');
    assert.ok(isFill(render({ n: 7, density: 'auto', layout: 'auto' })), 'the reported case');
    assert.ok(isFill(render({ n: 8, density: 'auto', layout: 'auto' })));
  });

  it('leaves two-row columns alone, where growth would make half-slide bands', () => {
    assert.ok(!isFill(render({ n: 2, density: 'auto', layout: 'one-column' })));
    assert.ok(!isFill(render({ n: 4, density: 'auto', layout: 'two-column' })), '2 rows per column');
  });

  it('leaves wrapped items alone, where centring would detach the marker', () => {
    assert.ok(!isFill(render({ n: 6, density: 'auto', layout: 'auto', title: LONG_TITLE })));
    // ~95-char body text wraps to a second line in BOTH a half-width and a
    // full-width column at the current sizes (the wrap point was re-measured in
    // A7.9 batch 2.5's tail — a full column keeps body text on one line only up
    // to ~60 chars, not "never" as the older heuristic assumed). Neither shape
    // fills: a grown, centred row detaches the marker from the wrapped line.
    assert.ok(!isFill(render({ n: 8, density: 'auto', layout: 'two-column', text: LONG_TEXT })));
    assert.ok(!isFill(render({ n: 4, density: 'auto', layout: 'one-column', text: LONG_TEXT })));
  });
});

describe('list-slide: layout choices', () => {
  it('explicit two-column is always honoured, even with few items', () => {
    assert.ok(isTwoCol(render({ n: 2, density: 'auto', layout: 'two-column' })));
  });

  it('explicit one-column is held while anything fits there', () => {
    assert.ok(isOneCol(render({ n: 5, density: 'auto', layout: 'one-column' })));
    assert.ok(isOneCol(render({ n: 6, density: 'auto', layout: 'one-column' })));
  });

  it('explicit one-column falls back to two columns only when nothing fits', () => {
    // Eight wordy items overflow one column at every size.
    assert.ok(isTwoCol(render({ n: 8, density: 'auto', layout: 'one-column', text: LONG_TEXT })));
  });

  it('legacy/unset layout resolves like auto', () => {
    assert.ok(isOneCol(render({ n: 4, density: 'auto', layout: undefined, text: '' })));
    assert.ok(isTwoCol(render({ n: 7, density: 'auto', layout: undefined })));
  });

  it('legacy/unset density resolves like auto', () => {
    assert.equal(resolve({ n: 3, density: undefined, layout: 'auto' }).size, 'comfortable');
    assert.equal(resolve({ n: 3, density: '', layout: 'auto' }).size, 'comfortable');
  });
});

describe('list-slide: exactly one type carries the List label', () => {
  // The List type was once registered twice — under `list-slide` and a Dutch
  // alias — so the picker offered two adjacent tiles both labelled "List". The
  // consolidation collapsed that to one; rung 3 removed the alias entirely. This
  // is the guard that the duplicate never comes back.
  it('is offered nowhere: exactly one insertable type carries the List label', () => {
    const insertable = Object.entries(SLIDE_TYPES).filter(
      ([, def]) => def?.deprecated !== true
    );
    const lists = insertable.filter(([, def]) => def.label === 'List');
    assert.deepEqual(
      lists.map(([name]) => name),
      ['list-slide'],
      'two insertable types labelled "List" is the bug this consolidation removed'
    );
  });
});
