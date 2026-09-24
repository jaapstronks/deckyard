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
import { ADMONITION_META } from '../../admonitions.js';

export default {
  structure: 'singleton',
  runtime: 'static',
  fidelity: { pptx: 'raster' },
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
      // The kind IS the meaning (a warning is not a tip), so it travels as
      // `data-variant` on the canvas root and the reader section (D130b).
      semantic: true,
      // Spelled out rather than derived from CALLOUT_VARIANTS: an option is
      // copy only when it declares a label (shared/ui-i18n-keys.js), and these
      // five are words a reader picks from, not storage tokens. The pair is
      // pinned against the vocabulary in tests/callout-slide.test.js.
      // `copyKey` names the same word in the deck's language (slide-copy.js),
      // read from the admonition table the canvas eyebrow reads, so `label`
      // below can fall back to it on every surface (`defaultFromOption`).
      options: [
        {
          value: 'insight',
          label: 'Key insight',
          copyKey: ADMONITION_META.insight.copyKey,
        },
        {
          value: 'warning',
          label: 'Warning',
          copyKey: ADMONITION_META.warning.copyKey,
        },
        {
          value: 'definition',
          label: 'Definition',
          copyKey: ADMONITION_META.definition.copyKey,
        },
        {
          value: 'note',
          label: 'Note',
          copyKey: ADMONITION_META.note.copyKey,
        },
        { value: 'tip', label: 'Tip', copyKey: ADMONITION_META.tip.copyKey },
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
      // Blank means the kind's own word, in the deck's language: the reader
      // eyebrow and the section's hidden heading say "Key insight" as the
      // canvas does, read from the option's `copyKey` (D130c).
      defaultFromOption: 'variant',
      // On a definition the label IS the term being defined, so the reader
      // wraps it in <dfn>; the sibling enum says when, not a branch on a name.
      // Only an authored term: the fallback word "Definition" defines nothing.
      termWhen: { field: 'variant', in: ['definition'] },
    },
    {
      key: 'body',
      essential: true,
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
      role: 'attribution',
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
