import { notFound } from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import { resolveLegacyPublication } from '../../storage/editions.js';
import { crossOrganizationScope } from '../../storage/scope.js';

/**
 * Where an old address points now: the same subresource of the edition the
 * conversion made for it (migration 105), with the language query carried
 * over. Null when the old id was never converted.
 *
 * @param {string} repoRoot
 * @param {string} legacyId
 * @param {string} prefix - `/p` or `/embed`
 * @param {string} suffix - `''` or `/reader`
 * @param {URL} url
 * @returns {Promise<string|null>}
 */
async function legacyTarget(repoRoot, legacyId, prefix, suffix, url) {
  const edition = await resolveLegacyPublication(
    crossOrganizationScope(
      repoRoot,
      'published-deck: the old publish id is the authorization',
    ),
    legacyId,
  );
  if (!edition) return null;
  const lang = url.searchParams.get('lang');
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : '';
  return `${prefix}/${edition.publicationId}/${edition.version}${suffix}${query}`;
}

/**
 * An old link answers with a permanent redirect to its first edition, never
 * to a later one: what was cited keeps showing what it showed on the day of
 * the conversion (D361). The slug is ignored; it never decided identity. A
 * revoked first edition is a tombstone at its own address.
 */
function redirectHandler(prefix, suffix) {
  return async ({ repoRoot, res, url }, legacyId) => {
    const location = await legacyTarget(
      repoRoot,
      legacyId,
      prefix,
      suffix,
      url,
    );
    if (!location) {
      notFound(res);
      return true;
    }
    res.writeHead(301, { Location: location, 'Cache-Control': 'no-store' });
    res.end();
    return true;
  };
}

/**
 * The old publication addresses, `/p/:publishId-:slug`, its reader and
 * `/embed/:publishId-:slug`. The eight-hex run is what separates the old id
 * from the slug; an edition address (`/p/:uuid/:version`) never matches.
 */
export const ROUTES = [
  {
    method: 'GET',
    pattern: /^\/p\/([a-f0-9]{8})(?:-[^/]+)?\/reader$/,
    captures: ['text'],
    handler: redirectHandler('/p', '/reader'),
  },
  {
    method: 'GET',
    pattern: /^\/p\/([a-f0-9]{8})(?:-[^/]+)?$/,
    captures: ['text'],
    handler: redirectHandler('/p', ''),
  },
  {
    method: 'GET',
    pattern: /^\/embed\/([a-f0-9]{8})(?:-[^/]+)?$/,
    captures: ['text'],
    handler: redirectHandler('/embed', ''),
  },
];

/**
 * Old publication links (open web, no auth): redirects to editions.
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>|false} true if handled.
 */
export function handlePublished(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
