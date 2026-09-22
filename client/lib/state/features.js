let FEATURES = null;

export function setFeatures(next) {
  FEATURES = next && typeof next === 'object' ? next : null;
}

export function getFeatures() {
  return FEATURES && typeof FEATURES === 'object' ? FEATURES : null;
}

/**
 * Whether this install has AI — the client's one reading of the server's
 * `enableAi` (off under `AI_ENABLED=false`, demo mode and sandbox).
 *
 * D179: where this is false an AI entry is absent from the DOM — not built,
 * not hidden with a style, not greyed out — because the server does not mount
 * the route behind it (404). Every AI entry asks this function, never the flag
 * itself; `tests/ai-entries-follow-enable-ai.test.js` holds the list of entries
 * and fails on a client call to an AI route that is not on it.
 *
 * @returns {boolean}
 */
export function aiEnabled() {
  return !!getFeatures()?.enableAi;
}

/**
 * Whether AI alt text can be generated: AI is on and the server's alt-text
 * vendor is configured (`aiAltText`, which the server derives from `enableAi`).
 * Both image pickers ask this, so they cannot disagree about the button.
 *
 * @returns {boolean}
 */
export function aiAltTextEnabled() {
  return aiEnabled() && !!getFeatures()?.aiAltText;
}
