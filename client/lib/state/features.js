let FEATURES = null;

export function setFeatures(next) {
  FEATURES = next && typeof next === 'object' ? next : null;
}

export function getFeatures() {
  return FEATURES && typeof FEATURES === 'object' ? FEATURES : null;
}

/**
 * Whether this installation has cluster `key` — the client's one reading of
 * the server's `enable<Key>` snapshot keys (D257, D260): `featureEnabled('ai')`
 * is `enableAi` (off under `AI_ENABLED=false`, demo mode and sandbox),
 * `featureEnabled('notion')` is `enableNotion`. Same key, same derivation as
 * the server's `isFeatureEnabled(key)`.
 *
 * D179/D260: where this is false the cluster's entry is absent from the DOM —
 * not built, not hidden with a style, not greyed out — because the server does
 * not mount the route behind it (404). Every entry asks this function, never
 * the flag itself; `tests/feature-entries-follow-flags.test.js` holds the list
 * of entries per cluster and fails on a client call to a cluster's route that
 * is not on it.
 *
 * @param {string} key - The cluster key (`'ai'`, `'notion'`, …)
 * @returns {boolean}
 */
export function featureEnabled(key) {
  const flag = `enable${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  return getFeatures()?.[flag] === true;
}

/**
 * Whether people on this install can share work with each other — the client's
 * one reading of the server's `enableSharing` (off in sandbox, D181).
 *
 * Unlike AI (D179), a sharing entry where this is false stays on screen,
 * greyed out, with one sentence of why (`sandbox.sharing.off`): sharing is
 * part of why someone picks Deckyard, so the sandbox shows it exists. Every
 * sharing entry asks this function, never `sandboxMode`.
 *
 * @returns {boolean}
 */
export function sharingEnabled() {
  return !!getFeatures()?.enableSharing;
}

/**
 * Whether AI alt text can be generated: AI is on and the server's alt-text
 * vendor is configured (`aiAltText`, which the server derives from `enableAi`).
 * Both image pickers ask this, so they cannot disagree about the button.
 *
 * @returns {boolean}
 */
export function aiAltTextEnabled() {
  return featureEnabled('ai') && !!getFeatures()?.aiAltText;
}
