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
    'user', 'users', 'users-three', 'handshake', 'link',
    'arrow-right', 'arrow-up', 'trend-up', 'chart-line-up',
    'file-text', 'clipboard-text', 'lightbulb', 'target',
    'rocket-launch', 'gear', 'shield-check', 'check-circle',
    'warning-circle', 'calendar', 'globe', 'heart', 'star',
  ],
};

/**
 * Filled-in examples for the generation prompt. Written against the legacy
 * numbered fields on purpose: they are what the v1 generator emits, and the
 * validator folds them into items[] downstream.
 * @type {Array<Object>}
 */
export const aiExamples = [
  {
    _variation: '4 cards (2x2 grid)',
    title: 'Our Strategic Pillars',
    subheading: 'Building for the future',
    cardCount: '4',
    card1Icon: 'lightbulb',
    card1Title: 'Innovation',
    card1Body: 'Driving creative solutions through research',
    card2Icon: 'users',
    card2Title: 'Collaboration',
    card2Body: 'Working together across all teams',
    card3Icon: 'target',
    card3Title: 'Focus',
    card3Body: 'Prioritizing what truly matters',
    card4Icon: 'rocket-launch',
    card4Title: 'Growth',
    card4Body: 'Scaling our impact continuously',
  },
  {
    _variation: '6 cards (2x3 grid)',
    title: 'Service Offerings',
    subheading: 'What we provide',
    cardCount: '6',
    card1Icon: 'gear',
    card1Title: 'Consulting',
    card1Body: 'Strategic advice and planning',
    card2Icon: 'file-text',
    card2Title: 'Research',
    card2Body: 'In-depth market analysis',
    card3Icon: 'chart-line-up',
    card3Title: 'Analytics',
    card3Body: 'Data-driven insights',
    card4Icon: 'users-three',
    card4Title: 'Training',
    card4Body: 'Team capability building',
    card5Icon: 'shield-check',
    card5Title: 'Compliance',
    card5Body: 'Regulatory guidance',
    card6Icon: 'globe',
    card6Title: 'Global Support',
    card6Body: '24/7 worldwide assistance',
  },
];
