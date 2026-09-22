/**
 * Row and column shape for a `tabular` items field.
 *
 * A tabular field (`structure: 'tabular'`, see ./structure.js) stores its cells
 * as an array of flat `c1…cN` objects plus a sibling column count, declared on
 * the field as `columnCountKey`. Two surfaces mutate that shape — the form's
 * table-grid widget (client/views/editor/fields/table-grid.js) and the canvas
 * inline editor (client/views/editor/inline-edit/inline-editor.js) — and before
 * this module they each had their own answer to "what is an empty row": the
 * grid wrote `{c1:'',…,cN:''}`, the canvas wrote `{}` (the `items` field has no
 * `itemDefaults`, so the generic skeleton resolved to nothing). The renderer
 * normalizes both, so nothing looked broken while two shapes for one concept
 * sat in decks side by side.
 *
 * One authority, here. The caller supplies the key names because the two
 * surfaces know them from different places — the canvas reads the field schema
 * (`columnCountKey`), the grid owns its type's fixed keys.
 */

/**
 * @param {*} n
 * @param {number} min
 * @param {number} max
 * @returns {number} `n` as an integer clamped to [min, max]; `min` when NaN.
 */
function clampInt(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

/**
 * The column count a tabular field currently has.
 *
 * A slide without a count takes the one its type declares in `defaults` - the
 * same seed a new slide clones, and the same one the semantic projection reads
 * - so there is no second default here. With neither, the table is one column
 * wide (the clamp's floor).
 *
 * @param {Object} content - the slide content holding the count
 * @param {Object} opts
 * @param {string} opts.columnCountKey - content key holding the count
 * @param {number} opts.maxCols
 * @param {Object} [opts.defaults] - the type's language-less `defaults`
 * @returns {number}
 */
export function tabularColumnCount(
  content,
  { columnCountKey, maxCols, defaults },
) {
  const count = content?.[columnCountKey] || defaults?.[columnCountKey];
  return clampInt(count, 1, maxCols);
}

/**
 * An empty row of `colCount` cells — the canonical new-row shape.
 *
 * @param {number} colCount
 * @returns {Object} `{ c1: '', …, cN: '' }`
 */
export function emptyTabularRow(colCount) {
  const row = {};
  const cols = clampInt(colCount, 1, Number.MAX_SAFE_INTEGER);
  for (let c = 1; c <= cols; c += 1) row[`c${c}`] = '';
  return row;
}

/**
 * Append a column: raise the count and give every existing row the new cell.
 *
 * @param {Object} content - mutated in place
 * @param {Object} opts
 * @param {string} opts.rowsKey - content key holding the row array
 * @param {string} opts.columnCountKey
 * @param {number} opts.maxCols
 * @param {Object} [opts.defaults] - the type's `defaults` (see tabularColumnCount)
 * @returns {boolean} false when already at `maxCols` (nothing mutated)
 */
export function addTabularColumn(
  content,
  { rowsKey, columnCountKey, maxCols, defaults },
) {
  if (!content) return false;
  const cols = tabularColumnCount(content, {
    columnCountKey,
    maxCols,
    defaults,
  });
  if (cols >= maxCols) return false;
  const next = cols + 1;
  content[columnCountKey] = String(next);
  const k = `c${next}`;
  for (const r of content[rowsKey] || []) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r[k] !== 'string') r[k] = '';
  }
  return true;
}

/**
 * Delete column `cIdx` (1-based) and shift the columns after it left, so
 * removing a middle column keeps the remaining content.
 *
 * @param {Object} content - mutated in place
 * @param {number} cIdx
 * @param {Object} opts
 * @param {string} opts.rowsKey
 * @param {string} opts.columnCountKey
 * @param {number} opts.maxCols
 * @param {Object} [opts.defaults] - the type's `defaults` (see tabularColumnCount)
 * @returns {boolean} false when only one column is left (nothing mutated)
 */
export function deleteTabularColumn(
  content,
  cIdx,
  { rowsKey, columnCountKey, maxCols, defaults },
) {
  if (!content) return false;
  const cols = tabularColumnCount(content, {
    columnCountKey,
    maxCols,
    defaults,
  });
  if (cols <= 1) return false;
  for (const r of content[rowsKey] || []) {
    if (!r || typeof r !== 'object') continue;
    for (let c = cIdx; c < cols; c += 1) {
      const next = r[`c${c + 1}`];
      r[`c${c}`] = typeof next === 'string' ? next : '';
    }
    delete r[`c${cols}`];
  }
  content[columnCountKey] = String(cols - 1);
  return true;
}
