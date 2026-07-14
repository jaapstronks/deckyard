/**
 * People & Organization Slide Type Definitions
 *
 * Slides for displaying people and organizations:
 * - team-cards-slide: Team member displays (members[] array)
 * - logo-wall-slide: Partner/sponsor logo grids (logos[] array)
 */

export const PEOPLE_SLIDES = {
  'team-cards-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Display team members, speakers, or a panel.
      Each person has a name, byline (role/function), and optional image.
      Up to 25 people. 3-6 is the sweet spot for detailed intros; larger
      rosters (advisory boards, full teams) work as a compact grid.

      STRUCTURE:
      - members: Array of member objects, each with { image, name, byline }
      - image can be empty string if unknown — the editor can add photos later
      - imageShape (optional): 'rounded' (default), 'square', or 'circle'.
        Prefer 'circle' for roster/board/team slides (portrait grids);
        keep 'rounded' for mixed-content image blocks.

      Use this whenever people are mentioned by name with their roles.
    `,
    bestFor: [
      'Team introductions (name + role)',
      'Speaker panels and line-ups',
      'Key contacts or stakeholders',
      'Advisory boards or committees (up to 25, use imageShape: circle)',
      'People mentioned by name + function in the source text',
    ],
    notFor: [
      'Very large teams with 25+ people (split into multiple slides)',
      'People without roles/titles (just mention them in content-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 200 },
      imageShape: { type: 'string', required: false, description: "'rounded' | 'square' | 'circle'" },
      members: {
        type: 'array',
        minItems: 1,
        maxItems: 25,
        itemSchema: {
          image: { type: 'string', required: false, description: 'Image URL or empty string' },
          name: { type: 'string', required: true, maxLength: 80 },
          byline: { type: 'string', required: true, maxLength: 120 },
        },
      },
    },
  },

  'logo-wall-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Display partner/sponsor/supporter logos in a grid.
      Each logo has a name and optional image. Up to 12 logos.

      STRUCTURE:
      - logos: Array of logo objects, each with { image, name }
      - image can be empty string if unknown — names alone create placeholder cards

      Use when partner organisations, sponsors, or supporters are mentioned.
      You don't need actual logo files — names are enough.
    `,
    bestFor: [
      'Partner organizations',
      'Sponsors and funding bodies',
      'Client logos',
      'Supporter acknowledgments',
      'Consortium or coalition members',
    ],
    notFor: [
      'Detailed partner descriptions (use content-slide or icon-card-grid-slide)',
      'People (use team-cards-slide)',
    ],
    schema: {
      title: { type: 'string', required: true, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 200 },
      logos: {
        type: 'array',
        minItems: 1,
        maxItems: 12,
        itemSchema: {
          image: { type: 'string', required: false, description: 'Logo URL or empty string' },
          name: { type: 'string', required: true, maxLength: 80 },
        },
      },
    },
  },
};
