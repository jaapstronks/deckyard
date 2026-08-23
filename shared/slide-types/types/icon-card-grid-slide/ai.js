/**
 * icon-card-grid-slide — the agent-facing editorial layer. **SERVER-ONLY.**
 *
 * This is the hand-written half of the agent contract: when to pick this type
 * and when not to. The other half — the field schema — is derived from
 * `index.js` by deriveAgentSchema() and is deliberately absent here (#407).
 *
 * ## Why this file is server-only, and enforced
 *
 * Deckyard has no bundler, so an `import` in a module the browser loads is a
 * file the browser fetches. The AI catalog is ~168 KB of prose that the browser
 * never executes; colocating it *and* importing it from `index.js` would add it
 * to the 368 KB of type modules every presenter page already pulls down. So the
 * rule is: `index.js` and `render.js` import nothing from here, and the server
 * catalog reaches in from its side. tests/slide-type-directory-boundary.test.js
 * fails if that ever stops being true — the brief's own point is that an
 * agreement without a test drifts.
 */

export const ai = {
  category: 'content',
  resolveInPhase1: false,
  description: `
      A VISUALLY STRIKING grid of 1-6 cards, each with an icon, title, and body text.
      This is one of the BEST slide types for presenting parallel concepts visually!

      STRUCTURE:
      - items: Array of 1-6 card objects, each with { icon, title, body }

      ICONS: Choose from this list - pick icons that represent the concept:
        People: user, users, users-three, handshake
        Progress: arrow-right, arrow-up, trend-up, chart-line-up, rocket-launch
        Documents: file-text, clipboard-text
        Concepts: lightbulb (ideas), target (goals), gear (settings), globe (global)
        Status: shield-check (security), check-circle (done), warning-circle (alert)
        Other: calendar, heart, star, link

      LAYOUT TIP: 4 cards = 2x2 grid, 5-6 cards = 2x3 grid. Very clean and professional.

      PREFER THIS over content-slide bullets when you have 4-6 distinct categories!
    `,
  bestFor: [
    '4-6 parallel categories or pillars',
    'Focus areas or strategic priorities',
    'Company values or principles',
    'Product features or capabilities',
    'Workstreams, departments, or teams',
    'Service offerings',
    'Benefits or advantages',
    'Any set of 4-6 things that can each have a meaningful icon',
  ],
  notFor: [
    'Time-based sequences (use timeline-slide)',
    'Items that need very long descriptions or bullets (use text-blocks-slide)',
    'Cause-effect relationships (use text-blocks-slide)',
    'Simple lists without icons (use list-slide)',
  ],
  allowedIcons: [
    'user',
    'users',
    'users-three',
    'handshake',
    'link',
    'arrow-right',
    'arrow-up',
    'trend-up',
    'chart-line-up',
    'file-text',
    'clipboard-text',
    'lightbulb',
    'target',
    'rocket-launch',
    'gear',
    'shield-check',
    'check-circle',
    'warning-circle',
    'calendar',
    'globe',
    'heart',
    'star',
  ],
};

/**
 * Filled-in examples for the generation prompt.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: '4 cards (2x2 grid)',
    title: 'Our Strategic Pillars',
    subheading: 'Building for the future',
    items: [
      {
        icon: 'lightbulb',
        title: 'Innovation',
        body: 'Driving creative solutions through research',
      },
      {
        icon: 'users',
        title: 'Collaboration',
        body: 'Working together across all teams',
      },
      {
        icon: 'target',
        title: 'Focus',
        body: 'Prioritizing what truly matters',
      },
      {
        icon: 'rocket-launch',
        title: 'Growth',
        body: 'Scaling our impact continuously',
      },
    ],
  },
  {
    _variation: '6 cards (2x3 grid)',
    title: 'Service Offerings',
    subheading: 'What we provide',
    items: [
      {
        icon: 'gear',
        title: 'Consulting',
        body: 'Strategic advice and planning',
      },
      {
        icon: 'file-text',
        title: 'Research',
        body: 'In-depth market analysis',
      },
      {
        icon: 'chart-line-up',
        title: 'Analytics',
        body: 'Data-driven insights',
      },
      {
        icon: 'users-three',
        title: 'Training',
        body: 'Team capability building',
      },
      {
        icon: 'shield-check',
        title: 'Compliance',
        body: 'Regulatory guidance',
      },
      {
        icon: 'globe',
        title: 'Global Support',
        body: '24/7 worldwide assistance',
      },
    ],
  },
];
