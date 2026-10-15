/**
 * Which control an enum field gets in the inspector, decided from what it has
 * to show (B457).
 *
 * The inspector column is drag-resizable but never narrower than
 * {@link INSPECTOR_MIN_COLUMN_PX}, and a segmented button never wraps its
 * text. So whether a segmented row fits is a property of the declaration: the
 * number of options times the width of their labels. This module estimates
 * that width from the label text alone — no browser, no layout pass — so the
 * renderer and the gate over every slide type (tests/enum-fit.test.js) make
 * the same call:
 *
 *   - one row of buttons that fits the column → segmented;
 *   - anything wider → a dropdown, never a segmented control that wraps onto a
 *     second row or clips its last button.
 *
 * The same estimate gives the field its size intent in the responsive
 * `.field-grid` (10-field-grid.css), replacing the old "count the options"
 * rule: a narrow control may pair with a neighbour, a wider one asks for its
 * own line.
 *
 * Widths are a conservative per-character table for the app's 13px/500 UI
 * face (Inter, falling back to system-ui; measured per glyph and rounded up),
 * so the estimate errs towards a dropdown rather than towards a clipped row.
 * An option that declares an `icon` renders as a fixed-width glyph, whatever
 * its label says; with `labelBeside` the glyph is narrower and the label is
 * counted too.
 */

/** The inspector form column at the minimum inspector width (320px), in px. */
export const INSPECTOR_MIN_COLUMN_PX = 279;

// `.field-grid` size bases (10-field-grid.css): default 10rem, wide 17rem.
const DEFAULT_BASIS_PX = 160;
const WIDE_BASIS_PX = 272;

// `.sb-segmented`: 4px padding and a 4px gap; `.sb-segmented-btn`: 12px
// padding either side; `.sb-icon`: 28px wide, or 20px plus a 6px gap when it
// sits beside its label (`.is-beside`, 40-option-icons.css).
const GROUP_PADDING_PX = 8;
const GAP_PX = 4;
const BUTTON_PADDING_PX = 24;
const ICON_PX = 28;
const ICON_BESIDE_PX = 26;

// `select.form-input`: horizontal padding plus the arrow.
const SELECT_CHROME_PX = 44;

const NARROW = new Set([...'fijlrtI()[].,;:/!|\'" ']);
const WIDE = new Set([...'mwMW']);

/**
 * Estimated rendered width of one label, in px.
 * @param {string} text
 * @returns {number}
 */
export function labelWidthPx(text) {
  let w = 0;
  for (const ch of String(text ?? '')) {
    if (NARROW.has(ch)) w += 5.1;
    else if (WIDE.has(ch)) w += 13;
    else if (/[A-Z0-9]/.test(ch)) w += 10;
    else w += 8.1;
  }
  return Math.ceil(w);
}

// The glyphs 40-option-icons.css draws (`.sb-icon-<name>`). Option
// declarations reach the inspector as JSON (/api/slide-types), also from
// custom and fork types, so an `icon` naming anything else would render an
// empty frame; such an option shows its label instead, and the width estimate
// counts the label it will show.
const OPTION_GLYPHS = new Set([
  'side-left',
  'side-right',
  'cols-1',
  'cols-2',
  'split-37',
  'split-50',
  'split-63',
]);

/**
 * The glyph an option renders, or '' when it renders its label.
 * @param {{icon?: string}} [opt]
 * @returns {string}
 */
export function optionGlyph(opt) {
  return opt?.icon && OPTION_GLYPHS.has(opt.icon) ? opt.icon : '';
}

/**
 * Estimated width of one segmented button's content, in px: the glyph when
 * the option draws one, the label when it does not, both when the glyph sits
 * beside the label.
 * @param {{label?: string, value?: string, icon?: string, labelBeside?: boolean}} opt
 * @returns {number}
 */
function buttonContentPx(opt) {
  if (!optionGlyph(opt)) return labelWidthPx(opt?.label ?? opt?.value);
  if (!opt.labelBeside) return ICON_PX;
  return ICON_BESIDE_PX + labelWidthPx(opt.label ?? opt.value);
}

/**
 * Estimated width of the options as one segmented row, in px.
 * @param {Array<{label: string, icon?: string, labelBeside?: boolean}>} options - resolved copy
 * @returns {number}
 */
export function segmentedRowPx(options) {
  const list = Array.isArray(options) ? options : [];
  const buttons = list.reduce(
    (sum, opt) => sum + BUTTON_PADDING_PX + buttonContentPx(opt),
    0,
  );
  return GROUP_PADDING_PX + buttons + GAP_PX * Math.max(0, list.length - 1);
}

/**
 * Estimated width a dropdown needs to show its longest option, in px.
 * @param {Array<{label: string}>} options - resolved copy
 * @returns {number}
 */
export function selectPx(options) {
  const list = Array.isArray(options) ? options : [];
  const longest = Math.max(
    0,
    ...list.map((opt) => labelWidthPx(opt?.label ?? opt?.value)),
  );
  return SELECT_CHROME_PX + longest;
}

function sizeFor(px) {
  if (px <= DEFAULT_BASIS_PX) return '';
  if (px <= WIDE_BASIS_PX) return 'wide';
  return 'full';
}

/**
 * The control for an enum with these options, and its size intent.
 *
 * `fits` is false only when even a dropdown cannot show the longest label in
 * the column — a label that is an explanation rather than a name. The
 * renderer still draws the dropdown (clipped); the gate refuses the
 * declaration.
 *
 * @param {Array<{label: string, icon?: string}>} options - resolved copy, in
 *   the language the inspector shows
 * @returns {{control: 'segmented'|'select', size: ''|'wide'|'full', widthPx: number, fits: boolean}}
 */
export function enumControl(options) {
  const row = segmentedRowPx(options);
  if (options?.length > 0 && row <= INSPECTOR_MIN_COLUMN_PX) {
    return {
      control: 'segmented',
      size: sizeFor(row),
      widthPx: row,
      fits: true,
    };
  }
  const px = selectPx(options);
  return {
    control: 'select',
    size: sizeFor(px),
    widthPx: px,
    fits: px <= INSPECTOR_MIN_COLUMN_PX,
  };
}
