/**
 * title-slide — the definition: label, fields, defaults and the render entry.
 *
 * The renderer lives in render.js, split into a view and its markup so a fork
 * can compose core's title layout instead of copying it (D270); the public
 * address for that is `shared/slide-types/core-layouts.js`. The authoring copy,
 * the inline-edit descriptor and the agent-facing prose live in sibling files
 * that their own consumer imports — see docs/reference/slide-type-directory.md.
 */

import { BACKGROUND_FIELD } from '../../helpers.js';
import renderHtml from './render.js';
import { TITLE_BLOCK } from './title-block.js';

export default {
  structure: 'singleton',
  runtime: 'static',
  fidelity: { pptx: 'native' },
  label: 'Title slide',
  fieldGroups: [TITLE_BLOCK.group],
  fields: [
    {
      key: 'title',
      role: 'heading',
      label: 'Title',
      labelKey: 'editor.slideField.title.label',
      type: 'string',
      required: true,
      // A title slide without its title looks broken, not sober (D211).
      essential: true,
      maxLength: 120,
      group: 'title-block',
      // Size only: the title block owns alignment (Layout chip). Composes with
      // the content-aware cover scale (render.js coverFontScale) - B277.
      textStyle: ['size'],
    },
    {
      key: 'subheading',
      label: 'Subtitle',
      type: 'string',
      required: false,
      maxLength: 160,
      group: 'title-block',
      textStyle: ['size'],
    },
    {
      // One generic meta line (author · date · organisation). Rendered in the
      // theme's label typography (caption font, uppercase, letterspaced,
      // muted) so it reads as a distinct role from the prose subtitle.
      key: 'meta',
      label: 'Meta',
      type: 'string',
      required: false,
      maxLength: 160,
      // Author, date, organisation: a byline, so the reader's <footer>.
      role: 'attribution',
      group: 'title-block',
      // No text-style offer: the byline stays at its label size (D241).
    },
    // Background image is the generic, type-agnostic `slideBgImage` field
    // (added by withGlobalSlideFields, rendered by injectSlideBackground). The
    // title type used to carry its own `bgImage`/`bgAlt` pair — now a read-only
    // render fallback for un-migrated decks, folded into `slideBgImage` on edit
    // (see ../legacy-bg-image.js).
    //
    // Background colour and logo corner are two compact controls that read as
    // one "chrome" choice, so they share a form row (see form-layout.js). The
    // colour itself renders in the shared Background section, which is why the
    // row usually carries the corner alone.
    { ...BACKGROUND_FIELD, formLayout: 'pair' },
    {
      key: 'logoCorner',
      label: 'Logo corner',
      type: 'enum',
      required: false,
      options: [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ],
      formLayout: 'pair',
    },
    // Last, because it has no primary home in the form: the toolbar "Layout"
    // chip owns the title block's alignment (see field-groups.js), so the raw
    // enum is a fallback surface, not the control.
    TITLE_BLOCK.field,
  ],
  // Layout catalogue for the editor's layout switcher: the horizontal
  // placement of the title block. Declared on the definition (JSON-safe) so a
  // fork overriding this type by name controls its own set. Shape documented
  // in types/image-text-slide.js.
  layoutVariants: TITLE_BLOCK.variants,
  defaultsByLang: {
    nl: {
      title: 'Nieuwe titel',
      subheading: '',
      meta: '',
      background: 'lime',
      logoCorner: 'right',
      titleBlockAlign: 'left',
    },
    'en-GB': {
      title: 'New title',
      subheading: '',
      meta: '',
      background: 'lime',
      logoCorner: 'right',
      titleBlockAlign: 'left',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  // `titleBlockAlign` is listed so activeLayoutVariantId resolves the left tile
  // as active on decks authored before the field existed, instead of showing no
  // tile selected.
  defaults: {
    title: 'New title',
    subheading: '',
    meta: '',
    background: 'lime',
    logoCorner: 'right',
    titleBlockAlign: 'left',
  },
  renderHtml,
};
