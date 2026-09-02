/**
 * The client's dev/prod boundary — one place that decides whether a
 * programming error is allowed to throw.
 *
 * The server has `NODE_ENV !== 'production'` (`getErrorStatus` in
 * `server/utils/http.js` throws on an unknown reason there). The client has
 * no bundler and no injected env flag, so the host is the signal: Deckyard is
 * developed on localhost, tested under jsdom (no host at all), and served to
 * users from a real domain. First used by the toast primitive (B203); shared
 * here so every UI primitive draws the same line instead of its own.
 */

/** Host names that mean "a developer is looking at this". */
const DEV_HOSTS = new Set(['', 'localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * Whether this runtime is a development one.
 * @returns {boolean} True outside production.
 */
export function isDevRuntime() {
  try {
    const loc = globalThis.window?.location ?? globalThis.location;
    return DEV_HOSTS.has(String(loc?.hostname ?? ''));
  } catch {
    return false;
  }
}

/**
 * Report a programming error: loud in development, survivable in production.
 *
 * A misuse of a UI primitive (a DOM node where text was expected, an unknown
 * kind) is a bug in the calling code, not a condition to tolerate. Throwing
 * in development gets it fixed; in production the user is not made to pay for
 * it, so it is logged and the caller falls back to something sensible.
 * @param {string} message - What the caller got wrong.
 */
export function reportMisuse(message) {
  if (isDevRuntime()) throw new Error(message);
  // eslint-disable-next-line no-console
  console.error(message);
}
