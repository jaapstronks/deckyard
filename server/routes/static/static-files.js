import path from 'node:path';
import { notFound, serveFile } from '../../utils/http.js';
import {
  CUSTOM_STYLES_URL,
  readCustomStylesCss,
} from '../../utils/css-chain.js';

/**
 * @typedef {object} StaticContext
 * @property {string} repoRoot
 * @property {import('http').IncomingMessage} req
 * @property {import('http').ServerResponse} res
 * @property {URL} url
 * @property {string} clientDir
 * @property {Array<{ urlPrefix: string, dir: string }>} sharedPublicDirs
 */

/**
 * Follow-code entry page (`/go`) — a static asset kept out of the SPA router.
 * @param {StaticContext} ctx
 * @returns {boolean} true if handled.
 */
export function handleGo({ req, res, url, clientDir }) {
  if (
    (url.pathname === '/go' || url.pathname === '/go/') &&
    req.method === 'GET'
  ) {
    const fsPath = path.join(clientDir, 'go.html');
    serveFile(res, fsPath);
    return true;
  }
  return false;
}

/**
 * GDPR self-service landing page (`/my-data`) — the friendly HTML the lead
 * verification email links to. A static asset kept out of the SPA router, like
 * `/go`; the page itself calls `GET`/`DELETE /api/leads/my-data` with the
 * `email` + `token` query params carried over from the email link.
 * @param {StaticContext} ctx
 * @returns {boolean} true if handled.
 */
export function handleMyData({ req, res, url, clientDir }) {
  if (
    (url.pathname === '/my-data' || url.pathname === '/my-data/') &&
    req.method === 'GET'
  ) {
    const fsPath = path.join(clientDir, 'my-data.html');
    serveFile(res, fsPath);
    return true;
  }
  return false;
}

/**
 * The fork CSS seam (`custom/styles/*.css`) as one stylesheet.
 *
 * Server-built documents inline the seam through `buildCssChain`; the app
 * shell is a static HTML file that cannot glob a directory, so it links this
 * URL instead — the same bytes, last in its <head>. Always 200, empty body
 * upstream, so the link is not a 404 on a stock install.
 *
 * `no-cache` (revalidate, don't reuse blind): a fork deploy changes this file
 * without changing its URL, and a stale seam in a browser cache looks exactly
 * like the seam not working.
 *
 * @param {StaticContext} ctx
 * @returns {boolean} true if handled.
 */
export function handleCustomStyles({ repoRoot, req, res, url }) {
  if (url.pathname !== CUSTOM_STYLES_URL || req.method !== 'GET') return false;
  const css = readCustomStylesCss(repoRoot);
  res.writeHead(200, {
    'Content-Type': 'text/css; charset=utf-8',
    'Content-Length': Buffer.byteLength(css, 'utf8'),
    'Cache-Control': 'no-cache',
  });
  res.end(css);
  return true;
}

/**
 * Serve files from the known shared public dirs (assets, uploads, …), guarding
 * against path traversal. `/uploads/` is user-controlled: risky types served inert.
 * @param {StaticContext} ctx
 * @returns {boolean} true if a prefix matched (handled, even on not-found).
 */
export function handleStaticFiles({ res, url, sharedPublicDirs }) {
  for (const { urlPrefix, dir } of sharedPublicDirs) {
    if (url.pathname.startsWith(urlPrefix)) {
      const relRaw = url.pathname.slice(urlPrefix.length);
      // Decode URL-escaped paths (e.g. spaces => %20) so filenames with spaces work.
      // Also prevent path traversal after decoding.
      let rel = relRaw;
      try {
        rel = decodeURIComponent(relRaw);
      } catch {
        rel = relRaw;
      }

      const base = path.resolve(dir);
      const fsPath = path.resolve(base, rel);
      if (fsPath !== base && !fsPath.startsWith(base + path.sep)) {
        notFound(res);
        return true;
      }

      // /uploads/ is user-controlled content: serve risky types (SVG) inert.
      serveFile(res, fsPath, { userUpload: urlPrefix === '/uploads/' });
      return true;
    }
  }
  return false;
}
