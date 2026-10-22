/**
 * A PowerPoint table (`a:tbl`) as a table block of the page model (B828).
 *
 * The table is structure already: rows, cells, a grid of column widths.
 * Each cell's text is its paragraphs joined by a space, literal; a cell
 * that continues a merged one (`hMerge`, `vMerge`) is empty, so every row
 * keeps the grid's columns. The header row is the table's `firstRow` flag,
 * or, for a producer that does not set it (pptxgenjs), a bold first row
 * over rows that are not, the rule `detectGeometry` applies to a PDF.
 */

import { EMU_PER_PT } from './package.js';
import {
  AVERAGE_CHAR_EM,
  LINE_HEIGHT_EM,
  readParagraphs,
} from './paragraphs.js';
import { boolAttr, child, childrenNamed, numAttr } from './xml.js';

/**
 * @param {import('./xml.js').XmlElement} tbl - `a:tbl`
 * @param {import('../pdf-extract/index.js').Box} box - the frame's box, pt
 * @param {Omit<import('./paragraphs.js').TextStyle, 'lists'> & { lists: import('./xml.js').XmlElement[] }} style -
 *   the list styles a cell falls back to after its own
 * @returns {{ block: object, lines: object[] }} the table block (without
 *   `box`) and one `table-cell` line per non-empty cell
 */
export function readTable(tbl, box, style) {
  const widths = childrenNamed(child(tbl, 'a:tblGrid'), 'a:gridCol').map(
    (col) => numAttr(col, 'w', 0) / EMU_PER_PT,
  );
  const lines = [];
  const rows = [];
  const rowBold = [];
  let top = box.y;
  for (const tr of childrenNamed(tbl, 'a:tr')) {
    const cells = [];
    const bold = [];
    let left = box.x;
    let column = 0;
    let rowSize = 0;
    for (const tc of childrenNamed(tr, 'a:tc')) {
      const span = Math.max(1, numAttr(tc, 'gridSpan', 1));
      const width = widths
        .slice(column, column + span)
        .reduce((sum, w) => sum + w, 0);
      column += span;
      const continued = boolAttr(tc, 'hMerge') || boolAttr(tc, 'vMerge');
      const paragraphs = continued
        ? []
        : readParagraphs(child(tc, 'a:txBody'), {
            ...style,
            lists: [
              child(child(tc, 'a:txBody'), 'a:lstStyle'),
              ...style.lists,
            ].filter(Boolean),
          }).filter((p) => p.text);
      const text = paragraphs.map((p) => p.text).join(' ');
      cells.push(text);
      if (text) {
        const size = Math.max(...paragraphs.map((p) => p.size));
        rowSize = Math.max(rowSize, size);
        const largest = paragraphs.find((p) => p.size === size);
        bold.push(paragraphs.every((p) => p.bold));
        const inset = numAttr(child(tc, 'a:tcPr'), 'marL', 91440) / EMU_PER_PT;
        lines.push({
          text,
          x: left + inset,
          y: top + size,
          width: Math.min(
            text.length * AVERAGE_CHAR_EM * size,
            Math.max(1, width - inset),
          ),
          size,
          bold: bold.at(-1),
          color: largest.color,
          role: 'table-cell',
        });
      }
      left += width;
    }
    rows.push(cells);
    rowBold.push(bold.length > 0 && bold.every(Boolean));
    top += Math.max(numAttr(tr, 'h', 0) / EMU_PER_PT, rowSize * LINE_HEIGHT_EM);
  }
  const firstRow = boolAttr(child(tbl, 'a:tblPr'), 'firstRow');
  const headerRow =
    firstRow ?? (rowBold[0] === true && rowBold.slice(1).every((b) => !b));
  return {
    block: {
      kind: 'table',
      y: lines[0]?.y ?? box.y,
      headerRow: Boolean(headerRow),
      rows,
    },
    lines,
  };
}
