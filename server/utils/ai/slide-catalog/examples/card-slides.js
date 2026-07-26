/**
 * Card-based Slide Type Examples
 * Icon grids, card stacks, team cards, and content columns
 */

export const CARD_SLIDE_EXAMPLES = {
  'icon-card-grid-slide': [
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
  ],

  'team-cards-slide': [{
    title: 'Leadership Team',
    subheading: 'Meet our experts',
    members: [
      { image: '', name: 'Jane Smith', byline: 'CEO' },
      { image: '', name: 'John Doe', byline: 'CTO' },
      { image: '', name: 'Alice Johnson', byline: 'COO' },
    ],
  }],

  'logo-wall-slide': [{
    title: 'Our Partners',
    subheading: 'Trusted collaborators',
    logos: [
      { image: '', name: 'Acme Corporation' },
      { image: '', name: 'Globex Industries' },
      { image: '', name: 'Initech' },
      { image: '', name: 'Umbrella Corp' },
    ],
  }],

  // content-columns-slide examples removed with the deprecated catalog entry
  // (see server/utils/ai/slide-catalog/basic-content-slides.js).
  //
  // card-stack-slide examples removed likewise: the type is deprecated
  // (superseded by icon-card-grid-slide) and has no catalog entry, so its three
  // examples were unreachable dead weight. Both removals are now held in place
  // by tests/slide-type-companion-coverage.test.js instead of by memory.
};