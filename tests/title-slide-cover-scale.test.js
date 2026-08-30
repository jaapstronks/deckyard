/**
 * Tests for the title slide's content-aware cover sizing.
 *
 * The renderer sets a per-slide --cover-scale from how much text the title
 * block carries (coverFontScale, the quoteFontScale pattern): a short cover
 * keeps the full 5xl hero size, a full one steps down — floor 0.8, exactly
 * one type step back to 4xl — so the fullest legal block (120-char title,
 * 160-char subtitle and meta) never leaves the frame. Title and subtitle
 * share the one scale, so their hierarchy never shifts.
 *
 * Run with: node --test tests/title-slide-cover-scale.test.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { renderSlideHtml } from '../shared/slide-types/presentation.js';
import { coverFontScale } from '../shared/slide-types/types/title-slide.js';

const X = (n) => 'x'.repeat(n);

function render(content, ctx) {
  return renderSlideHtml({ type: 'title-slide', id: 's1', content }, ctx);
}

function scaleFromHtml(html) {
  const m = html.match(/--cover-scale:([0-9.]+)/);
  return m ? Number(m[1]) : null;
}

describe('coverFontScale', () => {
  it('a typical cover stays at the full hero size (1)', () => {
    // 40-char title, 80-char subtitle, short meta — the everyday case.
    assert.equal(
      coverFontScale({ title: X(40), subheading: X(80), meta: X(30) }),
      1,
    );
  });

  it('the fullest legal block bottoms out at exactly one type step (0.8)', () => {
    // maxLength on every field: title 120, subheading 160, meta 160.
    assert.equal(
      coverFontScale({ title: X(120), subheading: X(160), meta: X(160) }),
      0.8,
    );
  });

  it('a max-length title alone barely dips', () => {
    const s = coverFontScale({ title: X(120), subheading: '', meta: '' });
    assert.ok(s < 1, `expected < 1, got ${s}`);
    assert.ok(s > 0.95, `a lone title must stay near hero size, got ${s}`);
  });

  it('subtitle and meta enter at reduced weight', () => {
    // The same character count moves the scale less through the subtitle
    // than through the title (the title wraps at ~24 chars/line at 5xl).
    const viaTitle = coverFontScale({ title: X(120) });
    const viaSubtitle = coverFontScale({ title: X(40), subheading: X(80) });
    assert.ok(
      viaSubtitle > viaTitle,
      `subtitle chars must weigh less: ${viaSubtitle} vs ${viaTitle}`,
    );
  });

  it('missing fields count as empty', () => {
    assert.equal(coverFontScale({}), 1);
    assert.equal(coverFontScale(null), 1);
  });

  it('never leaves [0.8, 1]', () => {
    for (const c of [
      {},
      { title: X(120), subheading: X(160), meta: X(160) },
      { title: X(500) }, // beyond maxLength — a hostile payload still clamps
    ]) {
      const s = coverFontScale(c);
      assert.ok(s >= 0.8 && s <= 1, `out of band: ${s} for ${JSON.stringify(c)}`);
    }
  });
});

describe('renderHtml wires the scale', () => {
  it('sets --cover-scale on the slide root', () => {
    const html = render({ title: X(120), subheading: X(160), meta: X(160) });
    assert.equal(scaleFromHtml(html), 0.8);
  });

  it('a short cover renders with scale 1, not without the var', () => {
    // Always present, like --quote-scale: one shape, no absent-var branch.
    const html = render({ title: 'Hello' });
    assert.equal(scaleFromHtml(html), 1);
  });
});
