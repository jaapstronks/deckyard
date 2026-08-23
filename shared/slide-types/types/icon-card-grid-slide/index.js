/**
 * icon-card-grid-slide — the definition.
 *
 * This is the isomorphic core of the type: what it is called, which fields it
 * has, what an empty one looks like, and how it renders. Everything the browser
 * needs to show a slide of this type is reachable from here, and *nothing else
 * is*: the authoring copy, the inline-edit descriptor and the agent-facing
 * editorial layer live in sibling files that their own consumer imports.
 *
 * The rule and the reasoning: docs/reference/slide-type-directory.md.
 * Gated by tests/slide-type-directory-boundary.test.js.
 */

import renderHtml from './render.js';

export default {
  structure: 'collection',
  fallback: 'list-slide',
  runtime: 'static',
  label: 'Icon cards',
  fields: [
    {
      key: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      maxLength: 120,
    },
    {
      key: 'subheading',
      label: 'Subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'layout',
      label: 'Layout',
      type: 'enum',
      required: false,
      options: [
        { value: 'cards', label: 'Cards' },
        { value: 'tiles', label: 'Tiles' },
      ],
    },
    {
      key: 'bottomSubheading',
      label: 'Bottom subheading',
      type: 'string',
      required: false,
      maxLength: 200,
    },
    {
      key: 'items',
      label: 'Cards',
      type: 'items',
      required: false,
      minItems: 1,
      maxItems: 6,
      collapsible: true, // item-rich: per-card collapse in the editor
      itemDefaults: {
        icon: 'lightbulb',
        title: 'Title',
        body: 'Description.',
        link: '',
      },
      itemDefaultsByLang: {
        nl: {
          icon: 'lightbulb',
          title: 'Titel',
          body: 'Omschrijving.',
          link: '',
        },
      },
      itemFields: [
        // `editor:` marks the widget exception beyond string/image (icon
        // picker); the closed vocabulary lands in editor-behaviour step 4.
        // `presentational`: the value is an icon NAME ("rocket"), a lookup key
        // into the icon set — not text. Without the declaration it is simply
        // the card's first string field, so the reader made it the card's
        // <h3> and pushed the real title down to a paragraph.
        {
          key: 'icon',
          label: 'Icon',
          type: 'string',
          required: false,
          maxLength: 40,
          editor: 'icon-picker',
          presentational: true,
        },
        {
          key: 'title',
          label: 'Title',
          type: 'string',
          required: false,
          maxLength: 80,
        },
        {
          key: 'body',
          label: 'Body',
          type: 'markdown',
          required: false,
          maxLength: 700,
        },
        // Optional: makes the whole card clickable. `#N` jumps to slide N in the
        // deck (presenter only); an http(s)/mailto URL opens in a new tab.
        {
          key: 'link',
          label: 'Link URL',
          type: 'string',
          required: false,
          maxLength: 500,
          editor: 'card-link',
        },
      ],
    },
  ],
  defaultsByLang: {
    nl: {
      title: 'Nieuwe titel',
      subheading: 'Optionele ondertitel',
      layout: 'cards',
      items: [
        {
          icon: 'lightbulb',
          title: 'Inzicht',
          body: 'Korte uitleg.',
          link: '',
        },
        { icon: 'target', title: 'Focus', body: 'Korte uitleg.', link: '' },
        { icon: 'users', title: 'Samen', body: 'Korte uitleg.', link: '' },
        { icon: 'settings', title: 'Proces', body: 'Korte uitleg.', link: '' },
        {
          icon: 'trending-up',
          title: 'Groei',
          body: 'Korte uitleg.',
          link: '',
        },
        {
          icon: 'shield-check',
          title: 'Kwaliteit',
          body: 'Korte uitleg.',
          link: '',
        },
      ],
    },
    'en-GB': {
      title: 'New title',
      subheading: 'Optional subtitle',
      layout: 'cards',
      items: [
        {
          icon: 'lightbulb',
          title: 'Insight',
          body: 'Short explanation.',
          link: '',
        },
        {
          icon: 'target',
          title: 'Focus',
          body: 'Short explanation.',
          link: '',
        },
        {
          icon: 'users',
          title: 'Together',
          body: 'Short explanation.',
          link: '',
        },
        {
          icon: 'settings',
          title: 'Process',
          body: 'Short explanation.',
          link: '',
        },
        {
          icon: 'trending-up',
          title: 'Growth',
          body: 'Short explanation.',
          link: '',
        },
        {
          icon: 'shield-check',
          title: 'Quality',
          body: 'Short explanation.',
          link: '',
        },
      ],
    },
  },
  // Back-compat fallback. Seeded in `items[]` — the numbered `card1*`…`card6*`
  // keys these used to write are gone (v7 -> v8), and seeding the flat form was
  // how a brand-new grid ended up stored in the legacy shape in the first place.
  defaults: {
    title: 'New title',
    subheading: 'Optional subtitle',
    layout: 'cards',
    items: [
      {
        icon: 'lightbulb',
        title: 'Insight',
        body: 'Short explanation.',
        link: '',
      },
      { icon: 'target', title: 'Focus', body: 'Short explanation.', link: '' },
      {
        icon: 'users',
        title: 'Together',
        body: 'Short explanation.',
        link: '',
      },
      { icon: 'gear', title: 'Process', body: 'Short explanation.', link: '' },
      {
        icon: 'trend-up',
        title: 'Growth',
        body: 'Short explanation.',
        link: '',
      },
      {
        icon: 'shield-check',
        title: 'Quality',
        body: 'Short explanation.',
        link: '',
      },
    ],
  },
  renderHtml,
};
