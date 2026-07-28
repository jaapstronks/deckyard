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
      key: 'cardCount',
      label: 'Cards',
      type: 'enum',
      required: false,
      options: ['1', '2', '3', '4', '5', '6'],
      // Legacy counter for the numbered card{N}* fields below; items[] carries
      // its own length. Out of the agent contract for the same reason they are,
      // and `deprecated` for the same reason: it is not part of the published
      // contract either.
      ai: false,
      deprecated: true,
    },

    // New items[] format (preferred for AI generation)
    {
      key: 'items',
      label: 'Cards',
      type: 'items',
      required: false,
      minItems: 1,
      maxItems: 6,
      itemDefaults: { icon: 'lightbulb', title: 'Title', body: 'Description.', link: '' },
      itemFields: [
        { key: 'icon', label: 'Icon', type: 'string', required: false, maxLength: 40 },
        { key: 'title', label: 'Title', type: 'string', required: false, maxLength: 80 },
        { key: 'body', label: 'Body', type: 'markdown', required: false, maxLength: 700 },
        // Optional: makes the whole card clickable. `#N` jumps to slide N in the
        // deck (presenter only); an http(s)/mailto URL opens in a new tab.
        { key: 'link', label: 'Link URL', type: 'string', required: false, maxLength: 500 },
      ],
    },

    // LEGACY: numbered card fields (card1Icon, card1Title, card1Body, etc.)
    // Kept for backward compatibility with existing slides and editor form.
    // The editor still reads/writes these; renderHtml reads items[] first.
    ...Array.from({ length: 6 }, (_, idx) => {
      const i = idx + 1;
      return [
        {
          key: `card${i}Icon`,
          label: `Card ${i} icon`,
          type: 'string',
          required: false,
          maxLength: 40,
          deprecated: true,
        },
        {
          key: `card${i}Title`,
          label: `Card ${i} title`,
          type: 'string',
          required: false,
          maxLength: 80,
          deprecated: true,
        },
        {
          key: `card${i}Body`,
          label: `Card ${i} body`,
          type: 'markdown',
          required: false,
          maxLength: 700,
          deprecated: true,
        },
        {
          key: `card${i}Link`,
          label: `Card ${i} link`,
          type: 'string',
          required: false,
          maxLength: 500,
          deprecated: true,
        },
      ];
    }).flat(),
  ],
  defaultsByLang: {
    nl: {
      title: 'Nieuwe titel',
      subheading: 'Optionele ondertitel',
      layout: 'cards',
      cardCount: '6',
      card1Icon: 'lightbulb',
      card1Title: 'Inzicht',
      card1Body: 'Korte uitleg.',
      card2Icon: 'target',
      card2Title: 'Focus',
      card2Body: 'Korte uitleg.',
      card3Icon: 'users',
      card3Title: 'Samen',
      card3Body: 'Korte uitleg.',
      card4Icon: 'settings',
      card4Title: 'Proces',
      card4Body: 'Korte uitleg.',
      card5Icon: 'trending-up',
      card5Title: 'Groei',
      card5Body: 'Korte uitleg.',
      card6Icon: 'shield-check',
      card6Title: 'Kwaliteit',
      card6Body: 'Korte uitleg.',
    },
    'en-GB': {
      title: 'New title',
      subheading: 'Optional subtitle',
      layout: 'cards',
      cardCount: '6',
      card1Icon: 'lightbulb',
      card1Title: 'Insight',
      card1Body: 'Short explanation.',
      card2Icon: 'target',
      card2Title: 'Focus',
      card2Body: 'Short explanation.',
      card3Icon: 'users',
      card3Title: 'Together',
      card3Body: 'Short explanation.',
      card4Icon: 'settings',
      card4Title: 'Process',
      card4Body: 'Short explanation.',
      card5Icon: 'trending-up',
      card5Title: 'Growth',
      card5Body: 'Short explanation.',
      card6Icon: 'shield-check',
      card6Title: 'Quality',
      card6Body: 'Short explanation.',
    },
  },
  // Back-compat fallback
  defaults: {
    title: 'New title',
    subheading: 'Optional subtitle',
    layout: 'cards',
    cardCount: '6',
    card1Icon: 'lightbulb',
    card1Title: 'Insight',
    card1Body: 'Short explanation.',
    card2Icon: 'target',
    card2Title: 'Focus',
    card2Body: 'Short explanation.',
    card3Icon: 'users',
    card3Title: 'Together',
    card3Body: 'Short explanation.',
    card4Icon: 'gear',
    card4Title: 'Process',
    card4Body: 'Short explanation.',
    card5Icon: 'trend-up',
    card5Title: 'Growth',
    card5Body: 'Short explanation.',
    card6Icon: 'shield-check',
    card6Title: 'Quality',
    card6Body: 'Short explanation.',
  },
  renderHtml,
};
