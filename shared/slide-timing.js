/**
 * Shared timing utilities for slide duration calculations.
 * Pure module — no framework deps, importable from client and server.
 */

export const DEFAULT_ADVANCE_INTERVAL_SECONDS = 20;

/**
 * Get the effective duration for a single slide.
 * @param {Object} slide - The slide object
 * @param {number} [deckDefaultSeconds] - Deck-level default (from autoAdvance.intervalSeconds)
 * @returns {number} Duration in seconds (1-300)
 */
export function getSlideEffectiveDuration(slide, deckDefaultSeconds) {
  if (
    slide?.duration != null &&
    typeof slide.duration === 'number' &&
    Number.isFinite(slide.duration) &&
    slide.duration >= 1 &&
    slide.duration <= 300
  ) {
    return Math.round(slide.duration);
  }
  const deck = Number(deckDefaultSeconds);
  if (Number.isFinite(deck) && deck >= 1 && deck <= 300) {
    return Math.round(deck);
  }
  return 20;
}

/**
 * Calculate total deck time from all slides.
 * @param {Array} slides - Array of slide objects
 * @param {number} [deckDefaultSeconds] - Deck-level default interval
 * @returns {{ totalSeconds: number, formatted: string }}
 */
export function calculateDeckTime(slides, deckDefaultSeconds) {
  const list = Array.isArray(slides) ? slides : [];
  let totalSeconds = 0;
  for (const slide of list) {
    totalSeconds += getSlideEffectiveDuration(slide, deckDefaultSeconds);
  }
  return { totalSeconds, formatted: formatDuration(totalSeconds) };
}

/**
 * Format a duration in seconds to a human-readable string.
 * @param {number} totalSeconds
 * @returns {string} e.g. "6m 40s" or "1h 10m"
 */
export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (s === 0) return '0s';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (m > 0) {
    return sec > 0 ? `${m}m ${sec}s` : `${m}m`;
  }
  return `${sec}s`;
}
