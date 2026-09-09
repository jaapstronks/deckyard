import {
  bgClass,
  escapeHtml,
  renderSubheadingHtml,
  BACKGROUND_FIELD,
  densityField,
} from '../helpers.js';
import { markdownToSafeHtml } from '../../markdown.js';
import { ACTIONS_FIELD, renderActionsHtml } from '../actions-field.js';
import {
  ASIDE_DEFAULTS,
  ASIDE_FIELDS,
  renderAsideHtml,
} from '../aside-field.js';
import { sharedOption } from '../../ui-i18n-keys.js';

export default {
  structure: 'singleton',
  runtime: 'static',
  label: 'Text slide',
  fields: [
    {
      key: 'title',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      labelKey: 'editor.slideField.subheading.label',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      // On the text slide this enum only toggles 1 vs 2 *text* columns
      // (renderHtml maps it to is-one-col/is-two-col). The toolbar "Layout"
      // chip owns the structural variant choice, so this inspector control is
      // labelled "Text columns" - reserving the word "Layout" for the chip.
      // Copy only this type uses, so it keeps its generated per-type key: the
      // `editor.slideField.*` namespace is for type-INDEPENDENT copy (D60), and
      // `editor.field.*` was a one-key third spelling of the same idea (B146).
      key: 'layout',
      label: 'Text columns',
      type: 'enum',
      required: false,
      options: [
        sharedOption(
          'editor.slideField.layout.option.two-column',
          'two-column',
          'Two columns',
        ),
        sharedOption(
          'editor.slideField.layout.option.one-column',
          'one-column',
          'One column',
        ),
      ],
    },
    // Two of the three shared stands: `auto` keeps the default sizing and
    // `compact` steps the body down one size so more copy fits. There is no
    // `comfortable` branch in renderHtml below, so the field does not offer it
    // — a stored one folds to `auto` (DENSITY_OPTIONS in helpers.js).
    densityField(['auto', 'compact']),
    {
      key: 'body',
      label: 'Body (Markdown)',
      labelKey: 'editor.slideField.body.label',
      type: 'markdown',
      // Long-form prose: the heading button earns its place here (see
      // shared/slide-types/field-behaviour.js for why it is off by default).
      toolbar: ['heading'],
      required: true,
      maxLength: 3000,
    },
    ...ASIDE_FIELDS,
    BACKGROUND_FIELD,
    ACTIONS_FIELD,
  ],
  // Layout catalogue for the editor's layout switcher: the text slide is the
  // zeroth variant of the image-text series, so the full series is reachable
  // from here too. The image tiles are cross-type (convert seam moves the
  // type, then the remaining `set` selects the target variant). Declared on
  // the definition (JSON-safe) so forks that override this type by name
  // control their own set. Shape documented in types/image-text-slide.js.
  layoutVariants: [
    {
      id: 'one-column',
      labelKey: 'editor.layoutVariant.oneColumn',
      label: 'One column',
      set: { layout: 'one-column' },
      schematic: {},
    },
    {
      id: 'two-column',
      labelKey: 'editor.layoutVariant.twoColumn',
      // "Text in two columns" (not just "Two columns") so it doesn't read as
      // the separate "Content columns" slide type (own fields per column).
      label: 'Text in two columns',
      set: { layout: 'two-column' },
      schematic: { textCols: 2 },
    },
    {
      id: 'split-narrow',
      labelKey: 'editor.layoutVariant.splitNarrow',
      label: 'Image 1/3',
      convertTo: 'image-text-slide',
      set: { layout: 'split', imageWidth: 'narrow' },
      schematic: { split: 37 },
    },
    {
      id: 'split-half',
      labelKey: 'editor.layoutVariant.splitHalf',
      label: 'Image 1/2',
      convertTo: 'image-text-slide',
      set: { layout: 'split', imageWidth: 'half' },
      schematic: { split: 50 },
    },
    {
      id: 'split-wide',
      labelKey: 'editor.layoutVariant.splitWide',
      label: 'Image 2/3',
      convertTo: 'image-text-slide',
      set: { layout: 'split', imageWidth: 'wide' },
      schematic: { split: 63 },
    },
    // The plural image layouts are image-set-slide since D100: two or three
    // images sharing one story is a different contract from one image beside
    // text, so these tiles convert to that type rather than to image-text.
    {
      id: 'top',
      labelKey: 'editor.layoutVariant.rowTop',
      label: 'Row above',
      convertTo: 'image-set-slide',
      set: { layout: 'top' },
      schematic: { row: 'top' },
    },
    {
      id: 'bottom',
      labelKey: 'editor.layoutVariant.rowBottom',
      label: 'Row below',
      convertTo: 'image-set-slide',
      set: { layout: 'bottom' },
      schematic: { row: 'bottom' },
    },
    {
      id: 'beside',
      labelKey: 'editor.layoutVariant.beside',
      label: 'Beside text',
      convertTo: 'image-set-slide',
      set: { layout: 'beside' },
      schematic: { duo: 45 },
    },
    {
      id: 'corner',
      labelKey: 'editor.layoutVariant.corner',
      label: 'Corner image',
      convertTo: 'image-text-slide',
      set: { layout: 'corner' },
      schematic: { corner: 45 },
    },
  ],
  defaultsByLang: {
    nl: {
      title: 'Nieuwe slide',
      subheading: '',
      // Default to a simple, readable layout. The AI wizard (and users) can opt into
      // two-column for dense content.
      layout: 'one-column',
      density: 'auto',
      body: '- Eerste punt\n- Tweede punt',
      ...ASIDE_DEFAULTS,
      background: 'lime',
      actions: [],
    },
    'en-GB': {
      title: 'New slide',
      subheading: '',
      // Default to a simple, readable layout. The AI wizard (and users) can opt into
      // two-column for dense content.
      layout: 'one-column',
      density: 'auto',
      body: '- First point\n- Second point',
      ...ASIDE_DEFAULTS,
      background: 'lime',
      actions: [],
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    title: 'New slide',
    subheading: '',
    // Default to a simple, readable layout. The AI wizard (and users) can opt into
    // two-column for dense content.
    layout: 'one-column',
    density: 'auto',
    body: '- First point\n- Second point',
    ...ASIDE_DEFAULTS,
    background: 'lime',
    actions: [],
  },
  renderHtml: (content, _slide, ctx) => {
    const bg = bgClass(content?.background);
    const layout =
      content?.layout === 'one-column' ? 'is-one-col' : 'is-two-col';
    // 'compact' takes the smaller body size; anything else is the default.
    const densityClass = content?.density === 'compact' ? ' is-compact' : '';
    const subheading = renderSubheadingHtml(content, 'subheading', 'subtitle');
    const actionsHtml = renderActionsHtml(content?.actions);
    // Body-adjacent commentary, so it sits under the body and above the CTAs:
    // an aside annotates what was just said, a call to action closes the slide.
    const asideHtml = renderAsideHtml(content, ctx);
    return `
        <div class="slide slide-content ${layout}${densityClass} ${bg}">
          <div class="slide-inner">
            <h2 class="heading" data-morph-role="title" data-inline-field="title" dir="auto">${escapeHtml(content?.title)}</h2>
            ${subheading}
            <div class="body" data-morph-role="body" data-inline-field="body" data-inline-kind="markdown">${markdownToSafeHtml(content?.body || '')}</div>
            ${asideHtml}
            ${actionsHtml}
          </div>
        </div>
      `;
  },
};
