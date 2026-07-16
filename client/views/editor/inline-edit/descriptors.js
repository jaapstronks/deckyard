/**
 * Inline-edit descriptors.
 *
 * The inline WYSIWYG editor is intentionally opt-in per slide type. A slide type
 * only becomes inline-editable once:
 *   1. its renderer emits `data-inline-field="<path>"` on the editable elements, and
 *   2. it has an entry here.
 *
 * Everything a descriptor needs beyond that (field type, required/optional,
 * maxLength, item field schema, min/max card counts) is read from the canonical
 * slide-type schema (`SLIDE_TYPES[type].fields`), so descriptors stay tiny.
 *
 * Shapes:
 *   ghosts: affordances shown for optional fields that are currently empty. Each
 *     entry shows a "+ <label>" chip on the overlay and spawns an editable
 *     element at a DOM anchor when clicked.
 *       { field, anchors: [{sel, pos, chip}, ...] }
 *     `anchors` is an ordered fallback list (first selector found in the DOM
 *     wins), so a ghost can target `.header` when it exists and `.slide-inner`
 *     when the header itself is omitted. `pos` is the DOM insertion position for
 *     the spawned editable ('prepend' | 'append' | 'before' | 'after'); `chip`
 *     is the overlay placement mode ('below-start' | 'top-start' |
 *     'bottom-start'). Legacy `{ field, anchor, pos }` still works.
 *   itemGhosts: ghosts for optional per-item subfields the renderer omits when
 *     empty (e.g. a timeline item's description).
 *       { list, field, item, within?, chipAnchor?, pos?, chip? }
 *     `list` is the primary collection key, `item` the item-element selector
 *     (elements carry data-inline-item-index), `within` an optional inner
 *     element to spawn into. `chipAnchor` is an optional selector inside the
 *     item element to pin the ghost CHIP to (the visible-hint position), for
 *     items whose element is a full-height layout column while the visible card
 *     is transform-positioned within it (timeline) - the chip lands on the card,
 *     not the column. The spawned edit still goes into `within`.
 *   cards: repeatable-items affordances (add/remove) driven by the schema's
 *     minItems / maxItems / itemDefaults.
 *       { field, fieldAliases?, container, itemSelector, removeAnchor?,
 *         removePlacement?, addAnchor?, addPlacement?, addLabelKey?, addLabel?,
 *         removeLabelKey?, removeLabel?, child? }
 *     `fieldAliases` lists legacy collection keys (`steps`, `stages`) so edits
 *     write to the array the renderer actually reads. `removeAnchor` is an
 *     optional selector inside the item element to pin the remove × to, for
 *     items whose element is a full-height layout column while the visible
 *     card is transform-positioned within it (timeline); `removePlacement`
 *     overrides the ×'s overlay placement (defaults to 'top-right' - use
 *     'bottom-right' when the item's top-right corner coincides with another
 *     ×). `addAnchor` overrides the element the "+ Add item" button is placed
 *     against (defaults to `container`); `addPlacement` overrides its overlay
 *     placement mode (defaults to 'bottom-center'). Use 'right-center' for
 *     single-row horizontal layouts whose new item appends to the right
 *     (timeline, horizontal process). `addPlacement` may be a function
 *     `(slide) => mode` when it depends on content (e.g. process direction).
 *     `addLabelKey`/`addLabel` (and the remove variants) override the generic
 *     "Add item"/"Remove item" copy per level.
 *   cards.child: a nested card level for two-level list types (text-blocks
 *     rows -> blocks). One card set is rendered per parent item element,
 *     scoped to it, writing to `${field}.{parentIdx}.${child.field}`; min/max/
 *     itemDefaults come from the nested itemFields schema.
 *       { field, itemSelector, removeAnchor?, removePlacement?, addPlacement?,
 *         addLabelKey?, addLabel?, removeLabelKey?, removeLabel?, ghosts? }
 *     The parent item element anchors the child's "+" chip. `ghosts` lists
 *     optional child-item subfields (`{ field, pos?, chip? }`) whose element
 *     the renderer omits when empty - a chip on the child item re-adds them.
 *   formText: side-form field keys whose editing is FULLY covered by the inline
 *     layer (plain text, markdown modal, and items whose subfields are all
 *     inline-editable). The side form tucks these behind its collapsed "Text"
 *     section so the visible form leads with design controls. A field whose
 *     editor also carries non-inline controls (icon pickers, image subfields,
 *     KPI delta/note, table column ops) must NOT be listed here.
 *
 *   media: per-image affordance. Clicking an element tagged
 *     `data-inline-photo="<n>"` opens an in-slide popover (image picker + alt
 *     text + optional extra fields like a LinkedIn URL). Two shapes:
 *       Array mode (`list` set): `<n>` is the index into `list`; the popover
 *         mutates the item object at that index. `imageField` / `altField` /
 *         `extraFields[].key` are the item's own keys.
 *         { list, photoSelector, imageField, altField, extraFields? }
 *       Flat mode (no `list`): the popover mutates `slide.content` directly.
 *         `imageField` / `altField` / `extraFields[].key` are content keys; a
 *         `{n}` token in any of them is replaced with `<n>` (e.g. a per-column
 *         `col{n}Image`). For a single-image type use plain keys and `<n>`=0.
 *         { photoSelector, imageField, altField, extraFields? }
 *     extraFields entries: `{key,type,label,i18nKey}`.
 *
 * @typedef {Object} InlineDescriptor
 * @property {Array<Object>} [ghosts]
 * @property {Array<Object>} [itemGhosts]
 * @property {{field:string, fieldAliases?:string[], container:string, itemSelector:string}} [cards]
 * @property {{list?:string, photoSelector:string, imageField:string, altField:string, extraFields?:Array<Object>}} [media]
 * @property {string[]} [formText]
 */

/**
 * The standard header pattern shared by most content/data-viz types: optional
 * `title` + `subheading` in a `.header` (or directly in `.slide-inner`) and an
 * optional `bottomSubheading` at the bottom. Renderers omit each element - and
 * the whole `.header` - when empty, hence the anchor fallbacks.
 */
const HEADER_GHOSTS = [
  {
    field: 'title',
    anchors: [
      { sel: '.header', pos: 'prepend', chip: 'top-start' },
      { sel: '.slide-inner', pos: 'prepend', chip: 'top-start' },
    ],
  },
  {
    field: 'subheading',
    anchors: [
      { sel: '.heading', pos: 'after', chip: 'below-start' },
      { sel: '.header', pos: 'append', chip: 'below-start' },
      { sel: '.slide-inner', pos: 'prepend', chip: 'top-start' },
    ],
  },
  {
    field: 'bottomSubheading',
    anchors: [{ sel: '.slide-inner', pos: 'append', chip: 'bottom-start' }],
  },
];

/**
 * The header text trio shared by the header-pattern types. All three are plain
 * inline-editable strings everywhere they appear.
 */
const HEADER_TEXT = ['title', 'subheading', 'bottomSubheading'];

/** @type {Record<string, InlineDescriptor>} */
export const INLINE_DESCRIPTORS = {
  'title-slide': {
    ghosts: [
      { field: 'subheading', anchor: '.tsu-meta', pos: 'prepend' },
      { field: 'byline', anchor: '.tsu-meta', pos: 'append' },
      { field: 'attribution', anchor: '.tsu-meta', pos: 'append' },
    ],
    formText: ['title', 'subheading', 'byline', 'attribution'],
  },
  'content-slide': {
    ghosts: [{ field: 'subheading', anchor: '.heading', pos: 'after' }],
    formText: ['title', 'subheading', 'body'],
  },
  'list-slide': {
    ghosts: [{ field: 'subheading', anchor: '.heading', pos: 'after' }],
    // "+ Text" chip on any item that has a title but no single-line text yet.
    // The renderer omits the empty .item-text div, so this is the only
    // affordance for adding it inline.
    itemGhosts: [
      { list: 'items', field: 'text', item: '.lijst-item', within: '.lijst-item-body', pos: 'append' },
    ],
    cards: {
      field: 'items',
      container: '.lijst',
      itemSelector: '.lijst-item',
    },
    formText: ['title', 'subheading', 'items'],
  },
  'quote-slide': {
    formText: ['quote', 'authorName', 'authorTitle'],
  },
  'chapter-title-slide': {
    formText: ['title'],
  },
  'image-text-slide': {
    ghosts: [{ field: 'caption', anchor: '.frame', pos: 'append' }],
    formText: ['title', 'caption', 'body'],
  },

  // ---- Data-viz types (shared header pattern + schema-driven cards) ----
  'timeline-slide': {
    ghosts: HEADER_GHOSTS,
    // The item element is a full-height column; the visible card is
    // transform-positioned within it. Pin the description chip to the card
    // (chipAnchor) so "+ Description" lands just under the milestone card, not
    // at the column bottom near the slide edge.
    itemGhosts: [
      { list: 'items', field: 'text', item: '.timeline-item', within: '.timeline-card', chipAnchor: '.timeline-card', pos: 'append' },
    ],
    // A new item appends to the right of the horizontal timeline, so the add
    // button sits at the right insertion point (on the track line), not
    // bottom-center over the bottom-subheading.
    cards: {
      field: 'items',
      container: '.timeline-container',
      itemSelector: '.timeline-item',
      removeAnchor: '.timeline-card',
      addPlacement: 'right-center',
    },
    formText: [...HEADER_TEXT, 'items'],
  },
  'process-slide': {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'items', field: 'text', item: '.process-step', within: '.step-content', pos: 'append' },
    ],
    // Horizontal process appends steps to the right (like timeline); vertical
    // process stacks them downward, so the add button follows the direction.
    cards: {
      field: 'items',
      fieldAliases: ['steps'],
      container: '.process-container',
      itemSelector: '.process-step',
      addPlacement: (slide) =>
        slide?.content?.direction === 'vertical' ? 'bottom-center' : 'right-center',
    },
    formText: [...HEADER_TEXT, 'items', 'steps'],
  },
  'funnel-slide': {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'items', field: 'value', item: '.funnel-stage', within: '.stage-content', pos: 'append', chip: 'top-start' },
      { list: 'items', field: 'text', item: '.funnel-stage', pos: 'append' },
    ],
    cards: { field: 'items', fieldAliases: ['stages'], container: '.funnel-container', itemSelector: '.funnel-stage' },
    formText: [...HEADER_TEXT, 'items', 'stages'],
  },
  'pyramid-slide': {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'levels', field: 'text', item: '.pyramid-level', within: '.level-content', pos: 'append' },
    ],
    cards: { field: 'levels', container: '.pyramid-container', itemSelector: '.pyramid-level' },
    formText: [...HEADER_TEXT, 'levels'],
  },
  'cycle-slide': {
    ghosts: [
      ...HEADER_GHOSTS,
      { field: 'centerLabel', anchors: [{ sel: '.cycle-center', pos: 'append', chip: 'top-start' }] },
    ],
    itemGhosts: [
      { list: 'items', field: 'text', item: '.cycle-stage', within: '.stage-details', pos: 'append' },
    ],
    cards: { field: 'items', fieldAliases: ['stages'], container: '.cycle-container', itemSelector: '.cycle-stage' },
    formText: [...HEADER_TEXT, 'centerLabel', 'items', 'stages'],
  },
  'matrix-slide': {
    ghosts: HEADER_GHOSTS,
    // cells are fixed 4/4 (min == max), so no add/remove buttons render; the
    // cards entry only provides item indexing for future use.
    cards: { field: 'cells', container: '.matrix-grid', itemSelector: '.matrix-cell' },
    formText: [...HEADER_TEXT, 'cells'],
  },
  'kpi-metrics-slide': {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'metrics', field: 'unit', item: '.kpi-metric', within: '.kpi-value', pos: 'append', chip: 'top-start' },
    ],
    cards: { field: 'metrics', container: '.kpi-grid', itemSelector: '.kpi-metric' },
    // metrics stays in the form: delta/note subfields have no inline path.
    formText: HEADER_TEXT,
  },

  // ---- Simple text types ----
  'lijstje-slide': {
    ghosts: [{ field: 'subheading', anchor: '.heading', pos: 'after' }],
    itemGhosts: [
      { list: 'items', field: 'text', item: '.lijst-item', within: '.lijst-item-body', pos: 'append' },
    ],
    cards: { field: 'items', container: '.lijst', itemSelector: '.lijst-item' },
    formText: ['title', 'subheading', 'items'],
  },
  'comparison-slide': {
    ghosts: [
      ...HEADER_GHOSTS,
      { field: 'leftTitle', anchors: [{ sel: '.comparison-side.left', pos: 'prepend', chip: 'top-start' }] },
      { field: 'leftBody', anchors: [{ sel: '.comparison-side.left', pos: 'append', chip: 'bottom-start' }] },
      { field: 'rightTitle', anchors: [{ sel: '.comparison-side.right', pos: 'prepend', chip: 'top-start' }] },
      { field: 'rightBody', anchors: [{ sel: '.comparison-side.right', pos: 'append', chip: 'bottom-start' }] },
      { field: 'verdict', anchors: [{ sel: '.comparison-split', pos: 'after', chip: 'below-start' }] },
    ],
    formText: [...HEADER_TEXT, 'leftTitle', 'leftBody', 'rightTitle', 'rightBody', 'verdict'],
  },
  'end-slide': {
    ghosts: [
      { field: 'body', anchors: [{ sel: '.heading', pos: 'after' }] },
      {
        field: 'contactName',
        anchors: [
          { sel: '.end-contact', pos: 'prepend' },
          { sel: '.slide-inner', pos: 'append', chip: 'bottom-start' },
        ],
      },
      {
        field: 'contactEmail',
        anchors: [
          { sel: '.end-contact', pos: 'append' },
          { sel: '.slide-inner', pos: 'append', chip: 'bottom-start' },
        ],
      },
      {
        field: 'contactPhone',
        anchors: [
          { sel: '.end-contact', pos: 'append' },
          { sel: '.slide-inner', pos: 'append', chip: 'bottom-start' },
        ],
      },
    ],
    // contactUrl / social links are URLs → stay in the form.
    formText: ['title', 'body', 'contactName', 'contactEmail', 'contactPhone'],
  },
  'image-slide': {
    ghosts: [
      {
        field: 'title',
        anchors: [
          { sel: '.img-heading', pos: 'prepend', chip: 'top-start' },
          { sel: '.slide-inner', pos: 'prepend', chip: 'top-start' },
        ],
      },
      {
        field: 'subheading',
        anchors: [
          { sel: '.img-title', pos: 'after' },
          { sel: '.img-heading', pos: 'append' },
          { sel: '.slide-inner', pos: 'prepend', chip: 'top-start' },
        ],
      },
      { field: 'caption', anchors: [{ sel: '.frame', pos: 'append', chip: 'bottom-start' }] },
      { field: 'bottomSubheading', anchors: [{ sel: '.slide-inner', pos: 'append', chip: 'bottom-start' }] },
    ],
    // Flat single image: clicking the frame sets image + alt in-slide. Focus,
    // role, layout and zoom stay in the side form.
    media: {
      photoSelector: '.image[data-inline-photo], .image-placeholder[data-inline-photo]',
      imageField: 'image',
      altField: 'alt',
    },
    formText: [...HEADER_TEXT, 'caption'],
  },
  'video-slide': {
    ghosts: [{ field: 'title', anchors: [{ sel: '.slide-inner', pos: 'prepend', chip: 'top-start' }] }],
    formText: ['title'],
  },
  'embed-slide': {
    ghosts: [{ field: 'title', anchors: [{ sel: '.slide-inner', pos: 'prepend', chip: 'top-start' }] }],
    formText: ['title'],
  },
  'countdown-slide': {
    ghosts: [{ field: 'title', anchors: [{ sel: '.slide-inner', pos: 'prepend', chip: 'top-start' }] }],
    formText: ['title'],
  },
  'chart-slide': {
    // Clicking the chart area opens the markdown data editor (the renderer tags
    // `.chart-area` with data-inline-field="data"). Chart type / labels / legend
    // stay in the side form.
    ghosts: [
      { field: 'subheading', anchors: [{ sel: '.chart-title-row', pos: 'after' }] },
      { field: 'bottomSubheading', anchors: [{ sel: '.slide-inner', pos: 'append', chip: 'bottom-start' }] },
    ],
    // 'data' stays: the form's chart-data editor has type-aware extras.
    formText: HEADER_TEXT,
  },
  'split-partner-title-slide': {
    ghosts: [
      { field: 'label', anchors: [{ sel: '.text', pos: 'prepend', chip: 'top-start' }] },
      { field: 'subheading', anchors: [{ sel: '.text .title', pos: 'after' }] },
    ],
    formText: ['label', 'title', 'subheading'],
  },

  // ---- Interactive types (question + options; results/QR stay as rendered) ----
  'poll-slide': {
    ghosts: [1, 2, 3, 4].map((n) => ({
      field: `option${n}`,
      group: 'options',
      anchors: [{ sel: '.poll-options', pos: 'append', chip: 'bottom-start' }],
    })),
    formText: ['question', 'option1', 'option2', 'option3', 'option4'],
  },
  'likert-slide': {
    ghosts: Array.from({ length: 10 }, (_, i) => ({
      field: `option${i + 1}`,
      group: 'options',
      anchors: [{ sel: '.likert-options', pos: 'append', chip: 'bottom-start' }],
    })),
    formText: ['question', ...Array.from({ length: 10 }, (_, i) => `option${i + 1}`)],
  },
  'likert-slider-slide': {
    ghosts: [
      { field: 'minLabel', anchors: [{ sel: '.likert-slider-label', pos: 'append' }] },
      { field: 'maxLabel', anchors: [{ sel: '.likert-slider-label.is-right', pos: 'append' }] },
    ],
    formText: ['question', 'minLabel', 'maxLabel'],
  },
  'feedback-slide': {
    formText: ['question'],
  },
  'lead-capture-slide': {
    ghosts: [
      { field: 'description', anchors: [{ sel: '.lead-capture-header', pos: 'append' }] },
    ],
    // Thank-you / privacy fields render only post-submit → stay in the form.
    formText: ['title', 'description', 'nameLabel', 'emailLabel', 'submitLabel'],
  },

  // ---- Card types (dual model: items[]/members[] or legacy numbered fields).
  // Renderers emit paths for whichever source they resolved; add/remove cards
  // only works in array mode (skipWhenEmpty guards the legacy decks). ----
  'icon-card-grid-slide': {
    ghosts: HEADER_GHOSTS,
    cards: {
      field: 'items',
      skipWhenEmpty: true,
      container: '.icon-card-grid',
      itemSelector: '.icon-card:not(.is-empty)',
    },
    // Card editors stay: they carry the icon pickers.
    formText: HEADER_TEXT,
  },
  'card-stack-slide': {
    ghosts: HEADER_GHOSTS,
    // Card count is an enum driving the numbered fields; stays in the form.
    formText: ['title', 'subheading'],
  },
  'team-cards-slide': {
    ghosts: [
      ...HEADER_GHOSTS,
      { field: 'subheading2', anchors: [{ sel: '.team-cards-group-right', pos: 'prepend', chip: 'top-start' }] },
    ],
    itemGhosts: [
      { list: 'members', field: 'name', item: '.team-card', pos: 'append', chip: 'top-start' },
      // Caption ghost sits directly under the title/text block (not over the
      // card bottom, which would land on the title text and the image outline).
      {
        list: 'members',
        field: 'byline',
        item: '.team-card',
        chipAnchor: '.team-card-text',
        pos: 'append',
        chip: 'below-start',
      },
    ],
    cards: {
      field: 'members',
      skipWhenEmpty: true,
      container: '.team-cards-grid',
      itemSelector: '.team-card',
    },
    // Clicking a card photo opens an in-slide media popover (image + alt +
    // LinkedIn), so slide-view users can set the whole block without the side form.
    media: {
      list: 'members',
      photoSelector: '.team-card-photo[data-inline-photo]',
      imageField: 'image',
      altField: 'alt',
      extraFields: [
        {
          key: 'linkedin',
          type: 'url',
          label: 'LinkedIn URL (optional)',
          i18nKey: 'editor.inline.media.linkedin',
        },
      ],
    },
    // Member cards stay in the side form too: they carry focus points.
    formText: [...HEADER_TEXT, 'subheading2'],
  },
  'logo-wall-slide': {
    ghosts: HEADER_GHOSTS,
    // Clicking a logo opens the media popover (image + alt). Logo names render
    // only as aria-labels, so name stays in the form (array-backed logos only).
    media: {
      list: 'logos',
      photoSelector: '.logo-wall-img[data-inline-photo], .logo-wall-placeholder[data-inline-photo]',
      imageField: 'image',
      altField: 'alt',
    },
    formText: ['title', 'subheading'],
  },
  'text-blocks-slide': {
    ghosts: HEADER_GHOSTS,
    // Row titles render for rows 2+ only (row 1 never has one); the ghost chip
    // sits at the row's top-left, where the spawned <h3> will appear.
    itemGhosts: [
      { list: 'rows', field: 'title', item: '.text-blocks-row', minIndex: 1, chip: 'top-start' },
    ],
    // Two-level cards: rows in the slide, blocks within each row. Rows append
    // at the bottom; blocks append to the right inside their row. The row's
    // remove × sits at its bottom-right corner because the top-right corner
    // coincides with the last block's own ×. skipWhenEmpty keeps legacy
    // numbered decks (no rows[]) free of affordances - the renderer reads the
    // numbered fields there, so writing rows[] would switch its data source.
    cards: {
      field: 'rows',
      skipWhenEmpty: true,
      container: '.text-blocks-content',
      itemSelector: '.text-blocks-row',
      removePlacement: 'bottom-right',
      addLabelKey: 'editor.inline.addRow',
      addLabel: 'Add row',
      removeLabelKey: 'editor.inline.removeRow',
      removeLabel: 'Remove row',
      child: {
        field: 'blocks',
        itemSelector: '.text-block',
        addPlacement: 'right-center',
        addLabelKey: 'editor.inline.addBlock',
        addLabel: 'Add block',
        removeLabelKey: 'editor.inline.removeBlock',
        removeLabel: 'Remove block',
        // A block whose title/body was cleared re-gains it via these chips
        // (the renderer omits the empty elements entirely).
        ghosts: [
          { field: 'title', chip: 'top-start' },
          { field: 'body', chip: 'bottom-start' },
        ],
      },
    },
    formText: HEADER_TEXT,
  },
  'content-columns-slide': {
    ghosts: HEADER_GHOSTS,
    // Clicking a column image opens the media popover (image + alt) writing to
    // the flat col{n}Image / col{n}Alt fields (data-inline-photo carries the
    // 1-based column number). Empty columns render no image element, so adding a
    // first image still happens in the side form; column count / fit / focus /
    // per-column block counts stay in the form too.
    media: {
      photoSelector: '.cc-image[data-inline-photo]',
      imageField: 'col{n}Image',
      altField: 'col{n}Alt',
    },
    formText: HEADER_TEXT,
  },

  // ---- Table & gallery ----
  'table-slide': {
    ghosts: [
      { field: 'caption', anchors: [{ sel: '.md-table-wrap', pos: 'after' }] },
    ],
    // Every cell is editable (rows.N.cM); add/remove works on whole rows. Note
    // the header is rows[0] when the header row is enabled.
    cards: { field: 'rows', container: '.md-table-wrap', itemSelector: '.md-table tr' },
    // rows stays: column add/remove only exists in the form's grid editor.
    formText: ['title', 'caption'],
  },
  'gallery-slide': {
    ghosts: HEADER_GHOSTS,
    itemGhosts: [
      { list: 'images', field: 'caption', item: '.gallery-item', pos: 'append', chip: 'bottom-start' },
    ],
    cards: { field: 'images', container: '.gallery-container', itemSelector: '.gallery-item' },
    // Clicking a gallery image opens the media popover (image + alt); caption is
    // inline-editable via the item ghost above.
    media: {
      list: 'images',
      photoSelector: '.gallery-image[data-inline-photo], .gallery-image-placeholder[data-inline-photo]',
      imageField: 'src',
      altField: 'alt',
    },
    // images stays: the per-image cards also carry focus-point controls.
    formText: HEADER_TEXT,
  },
};

/**
 * @param {string} type
 * @returns {InlineDescriptor | null}
 */
export function getInlineDescriptor(type) {
  return INLINE_DESCRIPTORS[type] || null;
}

/**
 * Side-form field keys fully covered by the inline layer for this type.
 * Empty for types without inline editing.
 * @param {string} type
 * @returns {string[]}
 */
export function getInlineFormTextKeys(type) {
  return INLINE_DESCRIPTORS[type]?.formText || [];
}
