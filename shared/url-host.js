/**
 * Host matching for URL allow-lists.
 *
 * The naive form of this check is `hostname.endsWith('youtube.com')`, which is
 * a substring test, not a host test: `notyoutube.com` and
 * `youtube.com.attacker.tld` both pass it. Every allow-list in this repo goes
 * through {@link hostMatches} instead, which accepts the domain itself and its
 * subdomains and nothing else.
 */

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
