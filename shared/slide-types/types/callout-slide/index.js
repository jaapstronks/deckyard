/**
 * callout-slide — the definition.
 *
 * The admonition family as one type with a `variant` enum, mirroring the
 * `variant` list-slide already proves: one CSS block, one agent entry, one
 * picker tile whose five presets stay discoverable. The variant carries the
 * semantics; nothing else about the type changes with it.
 *
 * This is the isomorphic core: label, fields, defaults and the render entry.
 * The authoring copy, the inline-edit descriptor and the agent-facing prose
 * live in sibling files that their own consumer imports — see
 * docs/reference/slide-type-directory.md, gated by
 * tests/slide-type-directory-boundary.test.js.
 */

import { BACKGROUND_FIELD } from '../../helpers.js';
import renderHtml from './render.js';
import { DEFAULT_CALLOUT_VARIANT } from './variants.js';

export default {
  structure: 'singleton',
  runtime: 'static',
  // Tier 2, so it names the tier-1 contract that holds its content without
  // losing any (shared/slide-types/tiers.js): an eyebrow, a body and an
  // attribution line are a title plus prose, which is content-slide.
  fallback: 'content-slide',
  label: 'Callout',
  // The eyebrow is what an outline should show, and for a definition it is the
  // term itself. Falls back to the built-in resolvers when it is blank.
  labelField: 'label',
  fields: [
    {
      key: 'variant',
      label: 'Kind',
      type: 'enum',
      required: true,
      // Spelled out rather than derived from CALLOUT_VARIANTS: an option is
      // copy only when it declares a label (shared/ui-i18n-keys.js), and these
      // five are words a reader picks from, not storage tokens. The pair is
      // pinned against the vocabulary in tests/callout-slide.test.js.
      options: [
        { value: 'insight', label: 'Key insight' },
        { value: 'warning', label: 'Warning' },
        { value: 'definition', label: 'Definition' },
        { value: 'note', label: 'Note' },
        { value: 'tip', label: 'Tip' },
      ],
    },
    {
      key: 'label',
      label: 'Label / term',
      type: 'string',
      required: false,
      maxLength: 80,
      // Blank is the normal state: the renderer falls back to the per-variant
      // eyebrow in the deck's language (shared/slide-types/slide-copy.js), so
      // an author gets the right word for free and overrides it when the
      // callout names something more specific — a definition's term, say.
      role: 'label',
    },
    {
      key: 'body',
      label: 'Body',
      type: 'markdown',
      required: true,
      // A callout that needs more than this is an argument, and an argument
      // wants content-slide or list-slide. The cap is the affordance.
      maxLength: 600,
      role: 'prose',
    },
    {
      key: 'source',
      label: 'Source',
      type: 'string',
      required: false,
      maxLength: 160,
      role: 'caption',
    },
    BACKGROUND_FIELD,
  ],
  defaultsByLang: {
    nl: {
      variant: DEFAULT_CALLOUT_VARIANT,
      label: '',
      body: 'Het ene ding dat je publiek moet onthouden.',
      source: '',
      background: 'mist',
    },
    'en-GB': {
      variant: DEFAULT_CALLOUT_VARIANT,
      label: '',
      body: 'The one thing your audience should remember.',
      source: '',
      background: 'mist',
    },
  },
  // The language-less seed: what every path with no deck language clones.
  // Key-identical to the maps above; see `defaults` in validate-definition.js.
  defaults: {
    variant: DEFAULT_CALLOUT_VARIANT,
    label: '',
    body: 'The one thing your audience should remember.',
    source: '',
    background: 'mist',
  },
  renderHtml,
};
