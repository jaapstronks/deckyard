/**
 * Media Slide Type Definitions
 *
 * Slides for media content:
 * - video-slide: Embedded video content
 * - embed-slide: Embedded live web content (iframe)
 */

export const MEDIA_SLIDES = {
  'video-slide': {
    category: 'media',
    resolveInPhase1: false,
    description: `
      Embed a video (YouTube, Vimeo, or direct URL).
      Use when video content is explicitly provided or requested.
    `,
    bestFor: ['Embedded video content'],
    notFor: ['Content without a video URL'],
  },

  'embed-slide': {
    category: 'media',
    resolveInPhase1: false,
    description: `
      Embed a live external page in an iframe (Figma, Miro, a dashboard, a
      Google Sheet). HTTPS only; a non-HTTPS URL renders as an empty frame.
      Only use it when a concrete embed URL is supplied — there is no sensible
      placeholder, and an embed of nothing is worse than a screenshot.
    `,
    bestFor: [
      'Showing a live prototype, board, or dashboard during the talk',
      'Content that must stay current between rehearsal and delivery',
    ],
    notFor: [
      'A video (use video-slide)',
      'A static picture of a tool (use image-slide)',
      'Any case where you would have to invent the URL',
    ],
  },
};