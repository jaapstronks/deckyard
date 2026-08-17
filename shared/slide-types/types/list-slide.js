import { bgClass, escapeHtml, renderSubheadingHtml, BACKGROUND_FIELD } from '../helpers.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';

/**
 * Title and subheading are one header block. The title box spans the slide
 * (1472px) while the subheading carries a 65% measure cap that also anchored it
 * to the start, so the two sat on centres 191px apart at a 1600px render:
 * setting both to `center` centred them on different axes. The list items are a
 * separate, internally consistent unit (they already carry role:'list-item' and
 * offer no alignment at all), so they stay out of this group.
 */
const HEADER_BLOCK = alignGroup('header-block', 'headerAlign', {
  label: 'Header alignment',
  schematicKind: 'bullets',
});

/**
 * Text sizes, largest first. 'normal' is the class-less default sizing; the
 * other two map to `.is-comfortable` ("Large") and `.is-compact` ("Small").
 */
const SIZE_ORDER = ['comfortable', 'normal', 'compact'];

/**
 * Up to this many items, one column is the natural shape for a list: it is how
 * a table of contents reads, and it gives each item the full measure. Beyond
 * it, two columns are what the content wants anyway, and they roughly double
 * the capacity so the type can stay large.
 */
const ONE_COLUMN_PREFERRED_MAX = 5;

/**
 * How many items fit at a given text size and column count.
 *
 * Every number here was MEASURED, not estimated: the real renderer plus the
 * real slide CSS in headless Chrome at 1600x900 on the default theme (Bricolage
 * Grotesque headings, Inter body), sweeping item count x title length x text
 * length x subheading x columns x text size, and reading back whether the last
 * item still ends above the slide's bottom padding edge. A cap is the largest
 * count that cleared it for every content shape in its bucket.
 *
 * Character counts stand in for line counts because `renderHtml` is a pure
 * string function that cannot measure anything. The wrap points below were
 * re-measured on the current sizes (A7.9 batch 2.5 nudged the comfortable
 * item-text a step, so the older "~60 chars = one line" conversion was stale
 * and the comfortable caps were one to two items too high on wrapping content).
 * The conversions, at "large" (comfortable):
 *   - full-width column: a title wraps to a 2nd line past ~55 chars, body text
 *     past ~60;
 *   - half-width column: a title wraps past ~40 chars (3rd line past ~79), body
 *     text past ~45 (3rd line past ~89).
 * Each wrapped line, and each intro subheading, costs roughly one item's worth
 * of capacity.
 *
 * @param {string} size - 'comfortable' | 'normal' | 'compact'
 * @param {boolean} twoCol - Whether the list renders in two columns
 * @param {{longestTitle: number, longestText: number, hasSubheading: boolean}} shape
 * @returns {number} Maximum item count that fits
 */
function itemCapacity(size, twoCol, shape) {
  const { longestTitle, longestText, hasSubheading } = shape;
  const hasText = longestText > 0;

  if (twoCol) {
    // Compact two columns clear the schema maximum of 8 items of any shape.
    // Normal two columns clear 8 too, with one measured exception (headless
    // Chrome, 1600×900, 2026-08-17, B54): when a subheading takes a row AND the
    // titles wrap to a third line (past ~79 half-width chars), the eighth — and
    // seventh — item spills ~11px past the bottom padding edge (847 vs 836).
    // The subheading is the row the comfortable branch already docks; a 3-line
    // title is what tips it over here. Everything else still clears 8.
    if (size !== 'comfortable') {
      if (size === 'normal' && hasSubheading && longestTitle > 79) return 6;
      return 8;
    }
    // Half-width wrap points (measured, current sizes): title → 2 lines past 40
    // and → 3 past 79; body text → 2 lines past 45 and → 3 past 89.
    const titleLines = longestTitle > 79 ? 3 : longestTitle > 40 ? 2 : 1;
    const textLines =
      longestText > 89 ? 3 : longestText > 45 ? 2 : hasText ? 1 : 0;
    if (titleLines === 1 && textLines <= 1) return 8;
    // A tall pair — two wrapped title lines with a ≥2-line body, or a 3-line
    // title with any wrapped body — only fits four across the two columns.
    if (titleLines + textLines >= 5) return 4;
    return 6;
  }

  // Full-width wrap points (measured, current sizes): title → 2 lines past 55,
  // body text → 2 lines past 60.
  const titleWraps = longestTitle > 55;
  const textWraps = longestText > 60;

  if (size === 'comfortable') {
    // A 2-line title already halves the room; a 2-line body AND a subheading on
    // top of that drop one more (three such items clear, but not with a sub).
    if (titleWraps) return hasText && textWraps && hasSubheading ? 2 : 3;
    if (!hasText) return 5;
    // A 2-line body, or an intro subheading, each cost one item's worth: the
    // fourth single-line item clears by ~56px, but either eats that room.
    if (textWraps || hasSubheading) return 3;
    return 4;
  }
  if (size === 'normal') {
    if (!hasText) return 7;
    return longestText > 80 ? 4 : 5;
  }
  // compact
  if (!hasText) return 8;
  return longestText > 100 ? 5 : 6;
}

/**
 * Resolve a list slide's text size and column count together.
 *
 * The two decisions are entangled - the capacity of a size depends on the
 * column count, and whether a column count is usable depends on the size - so
 * they are resolved as one, against {@link itemCapacity}. Two rules govern it:
 *
 * 1. An explicitly chosen text size outranks the column preference. Moving a
 *    list into two columns is a layout tweak; silently shrinking someone's
 *    type is a broken promise. Only when NO column count can hold the list at
 *    the chosen size does the size step down - and then `steppedDownFrom` is
 *    set so the editor can say so out loud.
 * 2. 'Auto' has no size opinion, so it holds the column preference instead and
 *    takes the largest size that fits there. Short lists come out large, which
 *    is what most of them want; wordy ones settle at the default fit.
 *
 * @param {Object} content - Slide content
 * @returns {{twoCol: boolean, size: string, steppedDownFrom: string|null,
 *   itemCount: number, longestTitle: number, longestText: number,
 *   hasSubheading: boolean}}
 */
export function resolveListLayout(content) {
  const items = Array.isArray(content?.items) ? content.items : [];
  const len = (v) => (typeof v === 'string' ? v.trim().length : 0);
  const itemCount = items.length;
  const longestTitle = items.reduce((mx, it) => Math.max(mx, len(it?.title)), 0);
  const longestText = items.reduce((mx, it) => Math.max(mx, len(it?.text)), 0);
  const hasSubheading = len(content?.subheading) > 0;
  const shape = { longestTitle, longestText, hasSubheading };

  // Legacy and unset values both mean "no opinion".
  const requested =
    content?.density === 'comfortable' || content?.density === 'compact'
      ? content.density
      : 'auto';

  const fits = (size, twoCol) => itemCount <= itemCapacity(size, twoCol, shape);

  // Column preference, most-preferred first. An explicit 'two-column' is a
  // dead end on purpose: the author asked for two columns, so there is nowhere
  // else to fall back to.
  const columns =
    content?.layout === 'two-column'
      ? [true]
      : content?.layout === 'one-column'
        ? [false, true]
        : itemCount > ONE_COLUMN_PREFERRED_MAX
          ? [true, false]
          : [false, true];

  const base = { itemCount, longestTitle, longestText, hasSubheading };

  if (requested === 'auto') {
    for (const twoCol of columns) {
      const size = SIZE_ORDER.find((s) => fits(s, twoCol));
      if (size) return { ...base, twoCol, size, steppedDownFrom: null };
    }
  } else {
    for (const twoCol of columns) {
      if (fits(requested, twoCol)) {
        return { ...base, twoCol, size: requested, steppedDownFrom: null };
      }
    }
    const smaller = SIZE_ORDER.slice(SIZE_ORDER.indexOf(requested) + 1);
    for (const twoCol of columns) {
      const size = smaller.find((s) => fits(s, twoCol));
      if (size) return { ...base, twoCol, size, steppedDownFrom: requested };
    }
  }

  // Unreachable with the schema's 8-item maximum (two columns at the small
  // size hold 8 of anything), but resolve to the safest shape rather than
  // return nothing if that maximum ever moves.
  return {
    ...base,
    twoCol: true,
    size: 'compact',
    steppedDownFrom: requested === 'compact' ? null : requested,
  };
}

/**
 * Whether every item is one line of title and at most one line of text.
 *
 * Same measured wrap points as {@link itemCapacity}: a full-width column keeps
 * a title on one line up to ~55 characters and body text up to ~60; a
 * half-width column, ~40 and ~45.
 *
 * @param {{twoCol: boolean, longestTitle: number, longestText: number}} resolved
 * @returns {boolean}
 */
function isSingleLine({ twoCol, longestTitle, longestText }) {
  return twoCol
    ? longestTitle <= 40 && longestText <= 45
    : longestTitle <= 55 && longestText <= 60;
}

export default {
  structure: 'collection',
  runtime: 'static',
  fieldGroups: [HEADER_BLOCK.group],
  layoutVariants: HEADER_BLOCK.variants,
  label: 'List',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
      group: 'header-block',
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 160,
      group: 'header-block',
    },
    // Style (bullets/numbers) and Layout (auto/one/two columns) are two small
    // enum selects that read as one choice, so they share a form row (see
    // form-layout.js) — the column choice stays visible next to the style
    // instead of dropping to the bottom of the form.
    {
      key: 'variant',
      label: 'Style',
      type: 'enum',
      required: false,
      options: [
        { value: 'bullets', label: 'Bullets' },
        { value: 'numbers', label: 'Numbers' },
      ],
      formLayout: 'pair',
    },
    {
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      options: [
        { value: 'auto', label: 'Auto (fit)' },
        { value: 'one-column', label: 'One column' },
        { value: 'two-column', label: 'Two columns' },
      ],
      formLayout: 'pair',
    },
    {
      key: 'density',
      label: 'Text size',
      type: 'enum',
      required: false,
      // 'auto' keeps the default sizing; 'comfortable' scales titles and text
      // up to fill sparse slides (few items); 'compact' shrinks them so many
      // items still fit on one slide.
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'comfortable', label: 'Large' },
        { value: 'compact', label: 'Small' },
      ],
    },
    BACKGROUND_FIELD,
    {
      key: 'items',
      label: 'Items',
      type: 'items',
      required: true,
      minItems: 2,
      maxItems: 8,
      itemDefaults: { title: '', text: '' },
      itemFields: [
        {
          key: 'title',
          label: 'Title',
          type: 'string',
          required: true,
          maxLength: 80,
          // Sits in a flex row next to the bullet/number marker; block
          // alignment would detach the text from its marker. See text-roles.js.
          role: 'list-item',
        },
        {
          key: 'text',
          label: 'Text (single line)',
          type: 'string',
          required: false,
          maxLength: 120,
          role: 'list-item',
        },
      ],
    },
    // Last, because it has no primary home in the form: the toolbar "Layout"
    // chip owns the header block's alignment (see field-groups.js), so the raw
    // enum is a fallback surface, not the control.
    HEADER_BLOCK.field,
  ],
  defaultsByLang: {
    nl: {
      title: 'Lijstje',
      subheading: '',
      headerAlign: 'left',
      variant: 'bullets',
      layout: 'auto',
      density: 'auto',
      items: [
        {
          title: 'Eerste punt',
          text: 'Korte toelichting op één regel',
        },
        {
          title: 'Tweede punt',
          text: 'Nog een korte toelichting',
        },
        { title: 'Derde punt', text: 'Hou dit compact' },
      ],
      background: 'lime',
    },
    'en-GB': {
      title: 'List',
      subheading: '',
      headerAlign: 'left',
      variant: 'bullets',
      layout: 'auto',
      density: 'auto',
      items: [
        {
          title: 'First point',
          text: 'Short explanation in one line',
        },
        {
          title: 'Second point',
          text: 'Another short explanation',
        },
        { title: 'Third point', text: 'Keep this compact' },
      ],
      background: 'lime',
    },
  },
  // Back-compat fallback
  defaults: {
    title: 'List',
    subheading: '',
    headerAlign: 'left',
    variant: 'bullets',
    layout: 'auto',
    density: 'auto',
    items: [
      {
        title: 'First point',
        text: 'Short explanation in one line',
      },
      {
        title: 'Second point',
        text: 'Another short explanation',
      },
      { title: 'Third point', text: 'Keep this compact' },
    ],
    background: 'lime',
  },
  renderHtml: (content) => {
    const bg = bgClass(content?.background);
    const variant =
      content?.variant === 'numbers'
        ? 'is-numbers'
        : 'is-bullets';
    // Text size and column count are resolved together, against a measured
    // capacity table — see resolveListLayout above. 'comfortable' (Large)
    // scales titles and text up so a short list fills the slide instead of its
    // top half; 'compact' (Small) shrinks them so a long one still fits.
    const resolved = resolveListLayout(content);
    const densityClass =
      resolved.size === 'comfortable'
        ? ' is-comfortable'
        : resolved.size === 'compact'
          ? ' is-compact'
          : '';
    const layout = resolved.twoCol ? 'is-two-col' : 'is-one-col';
    // Fill: let the rows share whatever height is left over instead of stacking
    // against the top of the slide. Sizing alone could not fix this - a list of
    // seven short items fits at Large and still left the bottom of the slide
    // empty, which was half the original report.
    //
    // Two gates bound it, and both are load-bearing:
    //
    // - Three rows per column. Growth is only ever leftover space shared
    //   between rows, so from three rows up each grows by a modest amount; at
    //   two, a short list turns into a pair of half-slide bands. A two-row
    //   column keeps its natural spacing and sits at the top, which is what a
    //   genuinely short list should do.
    // - Single-line rows. Filling centres each row's content in the height it
    //   gained, and centring is only right while the marker has one line to sit
    //   against: on a wrapped item the bullet would drift to the middle of the
    //   block instead of its title. Wordy lists are also the ones already near
    //   capacity, so they have little leftover to spend anyway.
    const rowsPerColumn = resolved.twoCol
      ? Math.ceil(resolved.itemCount / 2)
      : resolved.itemCount;
    const fillClass = rowsPerColumn >= 3 && isSingleLine(resolved) ? ' is-fill' : '';
    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const items = Array.isArray(content?.items)
      ? content.items
      : [];

    const renderItem = (it, idx) => {
      const t =
        typeof it?.title === 'string'
          ? it.title.trim()
          : '';
      // Force single-line text (also enforced visually via CSS).
      const x =
        typeof it?.text === 'string'
          ? it.text.replace(/\s*\n+\s*/g, ' ').trim()
          : '';
      const marker =
        variant === 'is-numbers'
          ? `<div class="marker" aria-hidden="true">${idx + 1}</div>`
          : `<div class="marker" aria-hidden="true"></div>`;
      // Omit the text element when empty so the inline editor can offer an
      // "+ Text" ghost affordance (see itemGhosts in descriptors.js) instead of
      // leaving an unclickable empty div. The renderer still emits it when the
      // ghost-spawn sentinel (zero-width space) is present, so editing works.
      const textHtml = x
        ? `<div class="item-text" data-inline-field="items.${idx}.text" dir="auto">${escapeHtml(x)}</div>`
        : '';
      return `
        <li class="lijst-item" data-inline-item="items" data-inline-item-index="${idx}">
          ${marker}
          <div class="lijst-item-body">
            <div class="item-title" data-inline-field="items.${idx}.title" dir="auto">${escapeHtml(t)}</div>
            ${textHtml}
          </div>
        </li>
      `;
    };

    // Native list semantics: numbered variant → <ol>, bullets → <ul>.
    const listTag = variant === 'is-numbers' ? 'ol' : 'ul';
    // Two-column: fill left column first, then right column. Each column is its
    // own native list so <li>s always sit directly inside a <ul>/<ol>.
    const isTwoCol = layout === 'is-two-col';
    let listHtml;
    if (isTwoCol && items.length > 1) {
      const midpoint = Math.ceil(items.length / 2);
      const leftItems = items.slice(0, midpoint);
      const rightItems = items.slice(midpoint);
      const leftHtml = leftItems.map((it, i) => renderItem(it, i)).join('');
      const rightHtml = rightItems.map((it, i) => renderItem(it, midpoint + i)).join('');
      listHtml = `
        <div class="lijst">
          <${listTag} class="lijst-col">${leftHtml}</${listTag}>
          <${listTag} class="lijst-col">${rightHtml}</${listTag}>
        </div>
      `;
    } else {
      const itemsHtml = items.map((it, idx) => renderItem(it, idx)).join('');
      listHtml = `<${listTag} class="lijst">${itemsHtml}</${listTag}>`;
    }

    const alignClass = groupAlignClass(HEADER_BLOCK.group, content);
    return `
      <div class="slide slide-lijstje ${variant} ${layout}${densityClass}${fillClass} ${bg}${
        alignClass ? ` ${alignClass}` : ''
      }">
        <div class="slide-inner">
          <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(content?.title)}</h2>
          ${subheading}
          ${listHtml}
        </div>
      </div>
    `;
  },
};