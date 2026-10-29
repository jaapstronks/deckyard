/**
 * The spelling of a slide selection (B871): slide numbers, 1-based as the
 * editor numbers its slides, with consecutive numbers folded into ranges.
 * `[1, 3, 4, 5]` is `1,3-5`. The export modal prefills its input with it and
 * the export filename carries it; the server's parser
 * (`parseSlideSelection()` in `server/services/exports.js`) reads it back.
 */

/**
 * Spell sorted slide numbers as a selection, runs as ranges.
 *
 * @param {number[]} numbers - sorted, de-duplicated
 * @param {string} [separator=','] - between runs; a filename takes `_`
 * @returns {string}
 */
export function spellSlideSelection(numbers, separator = ',') {
  const runs = [];
  for (const n of numbers) {
    const run = runs[runs.length - 1];
    if (run && n === run[1] + 1) run[1] = n;
    else runs.push([n, n]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(separator);
}
