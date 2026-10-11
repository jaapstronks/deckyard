/**
 * Installation configuration that seeds a slide type's content defaults — the
 * env half of the `configDefaults` declaration
 * (`shared/slide-types/config-defaults.js`, which holds the why and the
 * vocabulary).
 *
 * Declaration module in the sense of `config/features.js`: every env read for
 * this concern lives here, and the shared seam does the applying. Nothing in
 * `shared/` reads `process.env` — those modules also run in the browser, where
 * a default seeded from an env var would be a default only half the surfaces
 * agreed on (B650, B653).
 */

import { envStr } from './utils.js';
import { withConfiguredDefaults } from '../../shared/slide-types/config-defaults.js';

/**
 * What this installation configured, keyed by the source names in
 * `CONFIG_DEFAULT_SOURCES`. Read live rather than cached: `envStr` is cheap and
 * a snapshot taken at import time is a snapshot a test cannot change.
 *
 * @returns {Record<string, string>}
 */
export function instanceSlideDefaults() {
  return {
    // The Bunny Stream library new video slides start in (Stream > Video
    // Library in the Bunny dashboard). Unset is the honest default for core:
    // without one a bare video UUID embeds nothing and the slide shows its
    // "paste a link" state, which beats resolving it against somebody else's
    // library.
    'bunny-library-id': envStr('BUNNY_LIBRARY_ID'),
  };
}

/**
 * A slide-type map with this installation's configuration folded into the
 * defaults of the types that declare it.
 *
 * Two callers, and they are the two seams that build the type map a surface
 * hands out: `buildMergedSlideTypes()` (every server-side path that creates,
 * converts or validates a slide) and the `/api/slide-types` response (the map
 * the editor holds). Fold it in there and every creation path downstream is
 * covered without being handed an extra argument.
 *
 * `base` is explicit so this module does not import the registry: the registry
 * is what the callers already have, and `server/config/` stays a leaf.
 *
 * @param {Record<string, Object>} base - the map to configure
 * @returns {Record<string, Object>} the same map when nothing applies
 */
export function instanceSlideTypes(base) {
  return withConfiguredDefaults(base, instanceSlideDefaults());
}
