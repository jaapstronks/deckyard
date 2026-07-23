import path from 'node:path';
import { notFound, serveFile } from '../../utils/http.js';

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
  if ((url.pathname === '/go' || url.pathname === '/go/') && req.method === 'GET') {
    const fsPath = path.join(clientDir, 'go.html');
    serveFile(res, fsPath);
    return true;
  }
  return false;
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
