/** Browser-origin boundary for the cookie-authenticated collab upgrade. */
import { getAppBaseUrl } from '../config/utils.js';
import { getRequestOrigin } from '../utils/request-url.js';

/**
 * Native clients may omit Origin; browsers always send it on WebSockets.
 * A configured public URL is authoritative. Without one, use the existing
 * request URL convention (the proxy must overwrite forwarded headers).
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
export function isCollabOriginAllowed(req) {
  const source = req.headers.origin;
  if (source === undefined) return true;
  try {
    const origin = new URL(source);
    // An Origin is one serialized HTTP(S) origin, never a URL with a path,
    // credentials, a list, or the opaque origin "null".
    if (
      !['http:', 'https:'].includes(origin.protocol) ||
      origin.origin !== source
    )
      return false;
    const expected = new URL(getAppBaseUrl() || getRequestOrigin(req));
    return origin.origin === expected.origin;
  } catch {
    return false;
  }
}
