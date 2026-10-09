/**
 * chart-slide — the one-sentence summary of a chart, in the deck's language.
 *
 * It is the chart's text alternative, and there is one of it: the canvas puts
 * it in the chart's sr-only block, and the reader captions the decoded data
 * table with it (through the type's `datasetSummary`). Two sentences built in
 * two places would say two things about one chart.
 */

import { fillCopy, getSlideCopy } from '../../slide-copy.js';

/** Chart kind → the slide-copy key that names it. */
const KIND_COPY_KEYS = {
  bar: 'chartKindBar',
  pie: 'chartKindPie',
  line: 'chartKindLine',
};

/**
 * The name of a chart kind in the deck's language ("Staafdiagram", "Bar
 * chart"): the summary's subject and the SVG's accessible name.
 * @param {string} kind - `bar` | `pie` | `line`
 * @param {string} [lang] - the deck language
 * @returns {string} the name, or `''` for an unknown kind
 */
export function chartKindName(kind, lang) {
  return getSlideCopy(lang)[KIND_COPY_KEYS[kind]] || '';
}

/**
 * @param {object} parsed - the result of `parseChartData()`
 * @param {string} [lang] - the deck language
 * @returns {string} the summary, or `''` for a chart with nothing to summarise
 */
export function chartSummary(parsed, lang) {
  if (!parsed?.ok) return '';
  const copy = getSlideCopy(lang);
  const kind = chartKindName(parsed.kind, lang);
  if (!kind) return '';
  if (parsed.kind === 'bar' || parsed.kind === 'pie') {
    const { labels, values } = parsed.dataset;
    const pairs = labels
      .map((l, i) => ({ l: String(l || '').trim(), v: values[i] }))
      .filter((p) => typeof p.v === 'number');
    pairs.sort((a, b) => b.v - a.v);
    const top = pairs[0];
    if (!top) return '';
    return fillCopy(copy.chartSummaryTop, {
      kind,
      count: pairs.length,
      label: top.l,
      value: top.v,
    });
  }
  const all = [];
  for (const v of parsed.dataset.y1 || []) if (v != null) all.push(v);
  for (const v of parsed.dataset.y2 || []) if (v != null) all.push(v);
  if (!all.length) return '';
  return fillCopy(copy.chartSummaryRange, {
    kind,
    count: parsed.dataset.x.length,
    min: Math.min(...all),
    max: Math.max(...all),
  });
}
