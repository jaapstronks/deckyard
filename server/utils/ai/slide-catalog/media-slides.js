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
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      videoUrl: { type: 'string', required: true },
    },
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
    schema: {
      title: { type: 'string', required: false, maxLength: 120 },
      embedUrl: { type: 'string', required: true, maxLength: 500 },
      aspectRatio: { type: 'enum', required: false, options: ['16:9', '4:3', '1:1', 'auto'] },
      // 'restricted' blocks scripts and forms; only raise it to 'permissive'
      // when the embedded page is interactive and the author asked for it.
      sandbox: { type: 'enum', required: false, options: ['restricted', 'permissive'] },
    },
  },
};