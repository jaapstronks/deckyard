import { escapeHtml } from '../../helpers.js';
import { getSlideCopy } from '../../slide-copy.js';
import { CHART_ERROR } from './parse.js';

/** Parser error code → the slide-copy key that says it. */
const ERROR_COPY_KEYS = {
  [CHART_ERROR.empty]: 'chartErrorEmpty',
  [CHART_ERROR.tooFewRows]: 'chartErrorTooFewRows',
  [CHART_ERROR.tooFewDataRows]: 'chartErrorTooFewDataRows',
  [CHART_ERROR.noNumbers]: 'chartErrorNoNumbers',
  [CHART_ERROR.pieNegative]: 'chartErrorPieNegative',
  [CHART_ERROR.tooFewPoints]: 'chartErrorTooFewPoints',
  [CHART_ERROR.lineNumbers]: 'chartErrorLineNumbers',
  [CHART_ERROR.unknownType]: 'chartErrorUnknownType',
};

/**
 * Say the parser's error codes in the deck's language. An unmapped code is
 * shown as itself: a visible code names the gap, a blank line would hide it.
 * @param {string[]} errors - `CHART_ERROR` codes
 * @param {string} [lang] - the deck language
 * @returns {string[]}
 */
export function chartErrorMessages(errors, lang) {
  const copy = getSlideCopy(lang);
  return (errors || []).map((code) => copy[ERROR_COPY_KEYS[code]] || code);
}

/**
 * The card the canvas shows instead of a chart it cannot draw.
 * @param {string[]} errors - `CHART_ERROR` codes
 * @param {string} [lang] - the deck language
 * @returns {string}
 */
export function chartErrorHtml(errors, lang) {
  const copy = getSlideCopy(lang);
  const items = chartErrorMessages(errors, lang)
    .map((m) => `<li>${escapeHtml(m)}</li>`)
    .join('');
  return `
    <div class="chart-error" role="note" aria-label="${escapeHtml(copy.chartErrorsLabel)}">
      <div class="chart-error-title">${escapeHtml(copy.chartErrorTitle)}</div>
      <ul class="chart-error-list">${items}</ul>
    </div>
  `;
}
