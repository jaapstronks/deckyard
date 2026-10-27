import { slideFingerprint } from './slide-fingerprint.js';
import { DERIVED_SLIDE_CONTENT_KEYS } from './slide-types/compose.js';

/** The slide state an AI explanation describes, independent of id and notes. */
export function aiReviewFingerprint(slide) {
  const content = { ...(slide?.content || {}) };
  // Contrast caches are derived by either sampler after composition/save.
  for (const key of DERIVED_SLIDE_CONTENT_KEYS) delete content[key];
  if (content.slideLogo == null) content.slideLogo = 'none';
  if (content.slideBgImage && content.slideBgText == null)
    content.slideBgText = 'auto';
  return slideFingerprint({ type: slide?.type, content });
}

/** Whether a recorded explanation still describes this slide's content/type. */
export function isAiReviewCurrent(slide) {
  return (
    !!slide?._aiReview?.fingerprint &&
    slide._aiReview.fingerprint === aiReviewFingerprint(slide)
  );
}

/** Bind review evidence to the current slide after generation/normalization. */
export function bindAiReview(slide, evidence) {
  slide._aiReview = { ...evidence, fingerprint: aiReviewFingerprint(slide) };
  return slide;
}
