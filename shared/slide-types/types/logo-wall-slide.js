import {
  escapeHtml,
  pickAltText,
  nonEmpty,
  cardLinkOverlayHtml,
  bgClass,
  BACKGROUND_FIELD,
  imagePlaceholderHtml,
} from '../helpers.js';
import { alignGroup, groupAlignClass } from '../field-groups.js';

/**
 * Title and subheading are one header block. The title spans the slide (1504px)
 * while the subheading carries a 75ch measure cap that also anchored it to the
 * start, so the two sat on centres 251px apart at a 1600px render. The logo
 * grid is its own unit and is unaffected.
 */
const HEADER_BLOCK = alignGroup('header-block', 'headerAlign', {
  label: 'Header alignment',
  labelKey: 'editor.slideField.headerAlign.label',
  schematicKind: 'logos',
});
import { getSlideCopy } from '../slide-copy.js';

/** Cap for the logos[] array. */
export const MAX_LOGOS = 30;

/**
 * Normalize `logos[]` into the shape the renderer reads.
 *
 * Until the v7 -> v8 schema fold this also carried a second branch for the flat
 * `logo1Image`…`logo12Link` family (capped at 12, where `logoCount` was a
 * strictly validated enum). That family no longer exists — stored decks are
 * folded once at read time (`shared/slide-types/schema-version.js`), so
 * `logos[]` is the only shape there is.
 *
 * @param {Object} content
 * @returns {Array<{image: string, name: string, alt: string, link: string}>}
 */
function resolveLogos(content) {
  if (!Array.isArray(content?.logos)) return [];
  return content.logos.slice(0, MAX_LOGOS).map((l) => ({
    image: l?.image || '',
    name: l?.name || '',
    alt: l?.alt || '',
    link: l?.link || '',
  }));
}

/**
 * Canonicalize a logo wall to the array form (editor-only, idempotent).
 *
 * Materializes `logos[]` so the inline media popover and card affordances have
 * a stable, mutable array to write to. Never called from `renderHtml` (which
 * stays pure): the inline editor runs it via the descriptor's `ensure` knob.
 * Mirrors `ensureImageTextImages`.
 * @param {Object} content
 * @returns {Object} the same content object
 */
export function ensureLogos(content) {
  if (!content || typeof content !== 'object') return content;
  if (Array.isArray(content.logos) && content.logos.length > 0) {
    if (content.logos.length > MAX_LOGOS) content.logos.length = MAX_LOGOS;
    return content;
  }
  // Guarantee one slot so an empty wall still offers a clickable "add a first
  // logo" cell on the canvas.
  content.logos = [{ image: '', name: '', alt: '', link: '' }];
  return content;
}

export default {
  structure: 'collection',
  // Same as gallery: the items are images, so the image contract holds them.
  // The grid is the loss, not the logos.
  fallback: 'image-slide',
  runtime: 'static',
  fieldGroups: [HEADER_BLOCK.group],
  layoutVariants: HEADER_BLOCK.variants,
  label: 'Logo wall',
  fields: [
    HEADER_BLOCK.field,
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: false,
      maxLength: 120,
      group: 'header-block',
    },
    {
      key: 'subheading',
      label: 'Subheading',
      labelKey: 'editor.slideField.subheading.label',
      type: 'string',
      required: false,
      maxLength: 220,
      group: 'header-block',
    },
    BACKGROUND_FIELD,
    {
      key: 'logos',
      label: 'Logos',
      type: 'items',
      required: false,
      minItems: 0,
      maxItems: MAX_LOGOS,
      collapsible: true, // item-rich: per-logo collapse in the editor
      itemDefaults: { image: '', name: '', alt: '', link: '' },
      itemFields: [
        { key: 'image', type: 'image', label: 'Logo image' },
        { key: 'name', type: 'string', label: 'Name', maxLength: 80 },
        // Declared because the renderer reads it and itemDefaults seeds it —
        // it was only ever missing here (team-cards/gallery declare theirs).
        { key: 'alt', type: 'string', label: 'Alt text', maxLength: 180 },
        // Optional: makes the whole logo clickable. `#N` jumps to slide N in the
        // deck (presenter only); an http(s)/mailto URL opens in a new tab.
        // `editor:` marks the widget exception (step-4 vocabulary seed).
        {
          key: 'link',
          type: 'string',
          label: 'Link URL',
          maxLength: 500,
          editor: 'card-link',
        },
      ],
    },
  ],

  // A fresh wall opens with one (empty) logo cell, so the canvas has something
  // to click. Seeded in `logos[]` — the numbered `logo1*` keys this used to
  // write are gone (v7 -> v8).
  defaults: {
    headerAlign: 'left',
    title: '',
    subheading: '',
    background: 'mist',
    logos: [{ image: '', name: 'Logo', alt: '', link: '' }],
  },

  renderHtml: (content, _slide, ctx) => {
    const copy = getSlideCopy(ctx?.lang);
    const mode = ctx?.mode;
    const editMode = mode === 'edit';
    const logos = resolveLogos(content);

    // In the editor an empty wall still needs one clickable cell so a FIRST
    // logo can be added in-slide (the media popover writes logos[0]); present /
    // export stay empty. The inline editor's `ensure` knob (ensureLogos) has
    // already materialized content.logos, so index 0 has a live item to mutate.
    const renderLogos =
      logos.length > 0
        ? logos
        : editMode
          ? [{ image: '', name: '', alt: '', link: '' }]
          : [];

    const title = nonEmpty(content?.title);
    const subtitle = nonEmpty(content?.subheading);
    const hasHeader = !!(title || subtitle);
    const alignClass = groupAlignClass(HEADER_BLOCK.group, content);

    const headerHtml =
      title || subtitle
        ? `
          <div class="header">
            ${title ? `<h2 class="title" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(title)}</h2>` : ''}
            ${subtitle ? `<p class="subtitle" data-morph-role="subtitle" data-inline-field="subheading" dir="auto">${escapeHtml(subtitle)}</p>` : ''}
          </div>
        `
        : '';

    const items = [];
    for (let i = 0; i < renderLogos.length; i++) {
      const logo = renderLogos[i];
      const img = nonEmpty(logo.image);
      const name = nonEmpty(logo.name);

      const alt = pickAltText({
        explicit: logo.alt || name,
        src: img,
        fallbacks: [],
        hardFallback: 'Logo',
      });

      // Inline-edit hook: clicking the logo (filled or empty placeholder) in the
      // WYSIWYG editor opens the media popover (image + alt). The attribute is
      // inert on present/export; the inline editor's `ensure` knob guarantees a
      // matching logos[i] to write to.
      const photoAttr = ` data-inline-photo="${i}"`;
      const imgHtml = img
        ? `<img class="logo-wall-img"${photoAttr} src="${escapeHtml(img)}" alt="${escapeHtml(alt)}" />`
        : imagePlaceholderHtml({
            className: 'logo-wall-placeholder',
            label: copy.logoPlaceholder,
            attrs: photoAttr,
          });

      // Optional click behavior: a full-item overlay anchor (shared helper).
      // Suppressed in the editor so it never blocks the media popover.
      const linkHtml = cardLinkOverlayHtml(
        logo.link,
        mode,
        name || `Logo ${i + 1}`,
      );

      items.push(`
        <div class="logo-wall-item${linkHtml ? ' has-link' : ''}" role="group" data-inline-item="logos" data-inline-item-index="${i}" aria-label="${escapeHtml(
          name || `Logo ${i + 1}`,
        )}">
          <div class="logo-wall-frame">
            ${imgHtml}
          </div>
          ${linkHtml}
        </div>
      `);
    }

    const count = items.length;
    const emptyHtml =
      count === 0
        ? `
          <div class="logo-wall-empty" role="note">
            Voeg logo’s toe in de editor.
          </div>
        `
        : '';

    // Existing decks carry no background value; their historical look is mist.
    const bg = bgClass(content?.background || 'mist');

    // Counts 1-12 use the hand-tuned CSS tiers (fixed cell sizes that grow as
    // the wall empties). Beyond 12 the grid switches to fluid columns: a
    // steady 7-wide (8 for the last tier) so cell size stays consistent and
    // rows grow with the count.
    let fluidClass = '';
    let fluidStyle = '';
    if (count > 12) {
      const cols = count <= 28 ? 7 : 8;
      const rows = Math.ceil(count / cols);
      fluidClass = ' is-fluid';
      fluidStyle = ` style="--lw-cols: ${cols}; --lw-rows: ${rows};"`;
    }

    return `
      <div class="slide slide-logo-wall ${alignClass ? `${alignClass} ` : ''}${bg}${
        hasHeader ? ' has-header' : ''
      }${fluidClass}" data-logo-count="${count}"${fluidStyle}>
        <div class="slide-inner">
          ${headerHtml}
          <div class="logo-wall-grid">
            ${items.join('')}
          </div>
          ${emptyHtml}
        </div>
      </div>
    `;
  },
};
