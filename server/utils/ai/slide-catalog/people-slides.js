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
      A grid of image blocks — each block is an image with an optional Title
      and Caption. Labelled "Image blocks" in the editor. Despite the name,
      this is the general-purpose type for showing MULTIPLE separate images
      in one slide: people (portrait grids), product/UI screenshots,
      testimonials, or any mix of images with short labels. Up to 25 blocks;
      3-6 is the sweet spot for detailed intros, larger sets form a compact grid.

      STRUCTURE:
      - members: Array of blocks, each with { image, name (=Title),
        byline (=Caption), alt, linkedin }. image/name/byline may be empty.
      - imageAspect: 'square' (default, crops each image to a square) or
        'original' (no crop — shows each image at its native aspect ratio).
        RULE OF THUMB: use 'original' for screenshots, UI captures, logos, or
        any mixed-shape images you must NOT crop; use 'square' (with
        imageShape 'circle') for people/portrait grids.
      - imageShape: 'rounded' (default), 'square', or 'circle'. 'circle' forces
        a square crop — best for rosters/boards/team headshots.
      - textPosition: 'below' (default, Title+Caption under the image) or
        'split' (Title above image, Caption below).
      - showPhotoFrame: 'on' | 'off' (default) — adds a card frame behind each image.
      - columnSplit: '' | '1'..'5' — splits blocks into a left/right group with
        its own subheading (subheading2), e.g. two contrasting sets side by side.

      Use this whenever several distinct images belong together in one slide,
      or whenever people are mentioned by name with their roles.
    `,
    bestFor: [
      'Multiple screenshots / UI captures in one slide (imageAspect: original)',
      'Testimonials or mixed image grids with short labels',
      'Team introductions and speaker panels (name + role)',
      'Advisory boards or committees (up to 25, imageShape: circle)',
      'Any set of separate images that each want a small Title/Caption',
    ],
    notFor: [
      'A single hero image (use image-slide)',
      'One image beside a paragraph of text (use image-text-slide)',
      'A curated photo gallery with masonry/featured layout (use gallery-slide)',
      'More than 25 blocks (split into multiple slides)',
    ],
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 220 },
      imageAspect: { type: 'string', required: false, description: "'square' (crop) | 'original' (no crop — screenshots/logos)" },
      imageShape: { type: 'string', required: false, description: "'rounded' | 'square' | 'circle'" },
      textPosition: { type: 'string', required: false, description: "'below' (default) | 'split'" },
      showPhotoFrame: { type: 'string', required: false, description: "'off' (default) | 'on'" },
      columnSplit: { type: 'string', required: false, description: "'' (none) | '1'..'5' left-group columns" },
      members: {
        type: 'array',
        minItems: 1,
        maxItems: 25,
        itemSchema: {
          image: { type: 'string', required: false, description: 'Image URL or empty string' },
          name: { type: 'string', required: false, maxLength: 80, description: 'Block Title' },
          byline: { type: 'string', required: false, maxLength: 120, description: 'Block Caption' },
          alt: { type: 'string', required: false, maxLength: 180, description: 'Alt text for the image' },
          linkedin: { type: 'string', required: false, maxLength: 300, description: 'Optional LinkedIn URL (people)' },
        },
      },
    },
  },

  'logo-wall-slide': {
    category: 'content',
    resolveInPhase1: false,
    description: `
      Display partner/sponsor/supporter logos in a grid. Logos are shown
      uncropped (contained) with matched heights — never cropped — which is
      exactly what logo artwork needs. Each logo has a name, an optional image,
      and an optional link. Up to 30 logos; fewer logos render larger automatically.

      STRUCTURE:
      - logos: Array of logo objects, each with { image, name, link }
      - image can be empty string if unknown — names alone create placeholder cards
      - link (optional): makes the whole logo clickable — an http(s)/mailto URL,
        or '#N' to jump to slide N in the deck (presenter only)

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
      'Screenshots or photos that want captions (use team-cards-slide or gallery-slide)',
    ],
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      subheading: { type: 'string', required: false, maxLength: 220 },
      logos: {
        type: 'array',
        minItems: 1,
        maxItems: 30,
        itemSchema: {
          image: { type: 'string', required: false, description: 'Logo URL or empty string' },
          name: { type: 'string', required: true, maxLength: 80 },
          link: { type: 'string', required: false, maxLength: 500, description: "URL or '#N' slide jump" },
        },
      },
    },
  },
};
