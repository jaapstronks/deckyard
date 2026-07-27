/**
 * Structural Slide Type Definitions
 *
 * Structural slides define the presentation's framework:
 * - title-slide: Opening slide
 * - chapter-title-slide: Section dividers
 * - quote-slide: Prominent quotes
 * - payoff-slide: Closing slide
 *
 * These are typically resolved in Phase 1 of AI generation.
 */

export const STRUCTURAL_SLIDES = {
  'title-slide': {
    category: 'structural',
    resolveInPhase1: true,
    description: `
      The opening slide of a presentation. Always the first slide.
      Contains the presentation title, an optional subtitle (subheading, a
      short tagline), and an optional meta line (speaker · date · organisation).
    `,
    bestFor: ['Opening/first slide of any deck'],
    notFor: ['Anything other than the deck opening'],
  },

  'chapter-title-slide': {
    category: 'structural',
    resolveInPhase1: true,
    description: `
      A section divider that announces a new topic/chapter.
      Use to break up the presentation into logical sections.
      Should be followed by 1-4 content slides that elaborate on that chapter.
    `,
    bestFor: [
      'Introducing a new major section or topic',
      'Creating visual breaks between different parts of the presentation',
      'Helping audience understand the structure',
    ],
    notFor: [
      'Content that needs explanation (use content slides after this)',
      'Minor sub-topics within a section',
    ],
  },

  'quote-slide': {
    category: 'structural',
    resolveInPhase1: true,
    description: `
      A visually prominent slide for a single powerful quote.
      Great for interviews, testimonials, and memorable statements.
      Keep quotes short (1-3 sentences, max ~260 characters).
    `,
    bestFor: [
      'Direct quotes from interviews',
      'Memorable one-liners or punchy statements',
      'Testimonials or endorsements',
      'Key takeaways phrased as quotes',
    ],
    notFor: [
      'Long passages (summarize or use content-slide)',
      'Multiple quotes (use one quote-slide per quote, spaced apart)',
      'Back-to-back placement (space them out in the deck)',
    ],
    varietyRule: 'Never place two quote-slides adjacent to each other',
  },

  'payoff-slide': {
    category: 'structural',
    resolveInPhase1: true,
    description: `
      A clean closing/brand payoff slide. Usually the last slide.
      Contains minimal content - just a closing message or brand tagline.
    `,
    bestFor: ['Final slide of a presentation', 'Brand reinforcement'],
    notFor: ['Content that needs explanation', 'Anything mid-deck', 'Slides that need contact details (use end-slide)'],
  },

  'end-slide': {
    category: 'structural',
    resolveInPhase1: true,
    description: `
      A closing "Thank you" slide with optional contact information and social links.
      More functional than payoff-slide — includes space for contact details.
      Use as the last slide when the audience needs to know how to follow up.

      The social link labels name the network (LinkedIn, Mastodon, Bluesky…);
      the matching URL field holds the profile address.
    `,
    bestFor: [
      'Final slide with contact information',
      'Thank you / closing slide',
      'Slides where the audience needs follow-up details',
    ],
    notFor: [
      'Brand-only closing without contact info (use payoff-slide)',
      'Content slides mid-deck',
    ],
  },
};