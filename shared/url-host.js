/**
 * URL parsing and host matching for URL allow-lists.
 *
 * The naive form of this check is `hostname.endsWith('youtube.com')`, which is
 * a substring test, not a host test: `notyoutube.com` and
 * `youtube.com.attacker.tld` both pass it. Every allow-list in this repo goes
 * through {@link hostMatches} instead, which accepts the domain itself and its
 * subdomains and nothing else.
 */

/**
 * Parse a user-supplied URL string, or `null` when it is not a URL.
 *
 * `new URL()` is a throwing parser, so every call site that accepts pasted
 * input wrapped it in a `try`/`catch` whose only job was "not a URL, carry
 * on" — eleven of them across `shared/`, nine with an empty body that the
 * silent-failure gate (B106/B111/B150) rightly reads as a swallow. There is
 * nothing to record here: an unparseable string is the ordinary case for a
 * field a human types into, not a failure. So the throw is converted once,
 * here, and the call sites branch on `null` instead.
 *
 * Protocol-relative input (`//host/path`) is normalized to `https:` first,
 * because `new URL('//youtu.be/x')` throws without a base — every caller in
 * this repo did that normalization itself, in two spellings.
 *
 * @param {unknown} input - URL string; non-strings and blanks yield `null`.
 * @returns {URL|null} The parsed URL, or `null` when it does not parse.
 */
export function parseUrl(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  try {
    return new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  } catch {
    // Unparseable input is the expected case for a pasted field, not an
    // error to report: `null` is the answer, and callers branch on it.
    return null;
  }
}

/**
 * Does `hostname` equal `domain`, or is it a subdomain of it?
 *
 * Both sides are compared case-insensitively and with a single trailing dot
 * (the DNS root form, `youtube.com.`) removed, so a URL that carries one does
 * not slip past the list.
 *
 * @param {string} hostname - Host to test, e.g. `new URL(x).hostname`.
 * @param {string} domain - Registrable domain to match against, e.g. `youtube.com`.
 * @returns {boolean} True for `domain` itself and for `*.domain`.
 */
export function hostMatches(hostname, domain) {
  const h = normalizeHost(hostname);
  const d = normalizeHost(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

/**
 * Does `hostname` match any domain in the list?
 *
 * @param {string} hostname - Host to test.
 * @param {string[]} domains - Registrable domains to match against.
 * @returns {boolean}
 */
export function hostMatchesAny(hostname, domains) {
  if (!Array.isArray(domains)) return false;
  return domains.some((d) => hostMatches(hostname, d));
}

/** Lowercase, trim, and drop one trailing dot. */
function normalizeHost(value) {
  const s = String(value || '')
    .trim()
    .toLowerCase();
  return s.endsWith('.') ? s.slice(0, -1) : s;
}
