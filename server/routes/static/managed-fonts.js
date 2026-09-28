import { forbidden, notFound } from '../../utils/http.js';
import {
  isMediaProviderInitialized,
  getMediaProvider,
} from '../../media/index.js';
import {
  MANAGED_FONT_URL_PREFIX,
  managedFontKey,
} from '../../media/managed-fonts.js';

const FONT_MIME = { woff2: 'font/woff2', woff: 'font/woff' };

/**
 * `GET /fonts/managed/<file>` — an uploaded font variant, read privately from
 * the media provider and served by the app itself.
 *
 * Who may ask: anyone who can render a deck that uses the font, which includes
 * anonymous share-link and embed viewers — so the route needs no session. What
 * it withholds is everything a *public object* would give away: there is no
 * bucket or CDN address, the response may not be stored by a shared cache
 * (`private`), search engines are told not to index it, and it is only usable
 * from this origin — no `Access-Control-Allow-Origin` (a cross-origin
 * `@font-face` needs one), `Cross-Origin-Resource-Policy: same-origin`, and a
 * browser request that says it comes from another site is refused outright.
 * Boundary and non-promises: docs/reference/font-management.md § Private font
 * variants.
 *
 * @param {import('./static-files.js').StaticContext} ctx
 * @returns {Promise<boolean>} true if the path is this route's (handled).
 */
export async function handleManagedFont({ req, res, url }) {
  if (!url.pathname.startsWith(MANAGED_FONT_URL_PREFIX)) return false;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    notFound(res);
    return true;
  }

  if (req.headers?.['sec-fetch-site'] === 'cross-site') {
    forbidden(res, 'Managed fonts are served to this site only.');
    return true;
  }

  let file;
  try {
    file = decodeURIComponent(
      url.pathname.slice(MANAGED_FONT_URL_PREFIX.length),
    );
  } catch {
    file = '';
  }
  const key = managedFontKey(file);
  if (!key || !isMediaProviderInitialized()) {
    notFound(res);
    return true;
  }

  const buf = await getMediaProvider().readFile(key);
  if (!buf) {
    notFound(res);
    return true;
  }

  const ext = file.endsWith('.woff') ? 'woff' : 'woff2';
  res.writeHead(200, {
    'Content-Type': FONT_MIME[ext],
    'Content-Length': buf.length,
    // The key carries a random UUID, so the bytes behind a URL never change.
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
  return true;
}
