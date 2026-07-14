/**
 * Media Slide Type Definitions
 *
 * Slides for media content:
 * - video-slide: Embedded video content
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
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      videoUrl: { type: 'string', required: true },
    },
  },
};