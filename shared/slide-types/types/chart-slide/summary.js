/**
 * chart-slide — the one-sentence summary of a chart, in the deck's language.
 *
 * It is the chart's text alternative, and there is one of it: the canvas puts
 * it in the chart's sr-only block, and the reader captions the decoded data
 * table with it (through the type's `datasetSummary`). Two sentences built in
 * two places would say two things about one chart.
 */

import { getSlideCopy } from '../../slide-copy.js';

/** Chart kind → the slide-copy key that names it. */
const KIND_COPY_KEYS = {
  bar: 'chartKindBar',
  pie: 'chartKindPie',
  line: 'chartKindLine',
};

/**
 * Fill `{name}` placeholders in a copy template.
 * @param {string} template
 * @param {Record<string, string|number>} values
 * @returns {string}
 */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : m,
  );
}

/**
 * @param {object} parsed - the result of `parseChartData()`
 * @param {string} [lang] - the deck language
 * @returns {string} the summary, or `''` for a chart with nothing to summarise
 */
export function chartSummary(parsed, lang) {
  if (!parsed?.ok) return '';
  const copy = getSlideCopy(lang);
  const kind = copy[KIND_COPY_KEYS[parsed.kind]];
  if (!kind) return '';
  if (parsed.kind === 'bar' || parsed.kind === 'pie') {
    const { labels, values } = parsed.dataset;
    const pairs = labels
      .map((l, i) => ({ l: String(l || '').trim(), v: values[i] }))
      .filter((p) => typeof p.v === 'number');
    pairs.sort((a, b) => b.v - a.v);
    const top = pairs[0];
    if (!top) return '';
    return fill(copy.chartSummaryTop, {
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
  return fill(copy.chartSummaryRange, {
    kind,
    count: parsed.dataset.x.length,
    min: Math.min(...all),
    max: Math.max(...all),
  });
}
