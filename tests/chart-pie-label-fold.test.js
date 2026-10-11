/**
 * B257 B1-rest: a pie chart stored with the pre-1.0 `pieLabelMode: 'percent'`
 * folds to `'%'` in the schema funnel (`foldUnofferedTo` on the field), so the
 * renderer and the PPTX export keep no alias for it.
 *
 * Run with: node --test tests/chart-pie-label-fold.test.js
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { migratePresentation } from '../shared/slide-types/schema-version.js';

const chart = (pieLabelMode) => ({
  type: 'chart-slide',
  content: { chartType: 'pie', pieLabelMode },
});

test('a stored `percent` folds to `%` in every language version', () => {
  const out = migratePresentation({
    slides: [chart('percent')],
    i18n: { versions: { en: { slides: [chart('percent')] } } },
  });
  assert.equal(out.slides[0].content.pieLabelMode, '%');
  assert.equal(out.i18n.versions.en.slides[0].content.pieLabelMode, '%');
});

test('an offered value is left alone', () => {
  for (const mode of ['none', 'value', '%', 'both']) {
    const out = migratePresentation({ slides: [chart(mode)] });
    assert.equal(out.slides[0].content.pieLabelMode, mode);
  }
});
