/**
 * Authentication + authorization for the collaboration WebSocket endpoint.
 *
 * Reuses the exact same primitives as the REST routes: the sb_session cookie
 * (which the browser sends on a same-origin WebSocket upgrade) resolves to a
 * user via auth.js, and per-document access uses the canonical
 * getCollaboratorPermission + canRead/canWritePresentation pair.
 */

import { getUserFromRequestAsync } from '../auth/auth.js';
import { getPresentation } from '../storage/presentations.js';
import { getCollaboratorPermission } from '../storage/collaborators.js';
import {
  canReadPresentation,
  canWritePresentation,
} from '../utils/presentation-authz.js';

/** Collab document names are `presentation:<id>` — one room per deck. */
export const COLLAB_DOC_PREFIX = 'presentation:';

function httpError(message, statusCode) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/**
 * Resolve the user from a WebSocket upgrade request.
 * crossws hands us a WHATWG-style Request proxy; auth.js expects a node-style
 * req with `headers.cookie`, so shim the one header it reads.
 *
 * @param {Request} request - upgrade request (crossws NodeReqProxy)
 * @returns {Promise<Object|null>} user object or null when unauthenticated
 */
export async function authenticateUpgradeRequest(request) {
  const cookie = request?.headers?.get?.('cookie') || '';
  const shim = { headers: { cookie } };
  const user = await getUserFromRequestAsync(shim);
  return user || null;
}

/**
 * Extract the presentation id from a collab document name.
 * The document name is arbitrary Yjs-protocol application data (a client can
 * open a provider with any name), and the extracted id flows into
 * `getPresentation` → `presPath` (`path.join(dataDir, 'presentations',
 * `${id}.json`)`), which does not sanitize it. Without a charset guard a name
 * like `presentation:../../../../etc/foo` would resolve outside the
 * presentations directory. Restrict the id to the same safe charset the ydoc
 * `.bin` backend already enforces (`ydoc-state.js` `safeId`); real ids are
 * uuids. Anything else is rejected as an unknown document.
 *
 * @param {string} documentName
 * @returns {string|null}
 */
export function presentationIdFromDocumentName(documentName) {
  const name = String(documentName || '');
  if (!name.startsWith(COLLAB_DOC_PREFIX)) return null;
  const id = name.slice(COLLAB_DOC_PREFIX.length).trim();
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  return id;
}

/**
 * Authorize a user for a collab document. Throws (rejecting the connection)
 * unless the user may at least read the presentation; connections without
 * write permission become read-only (presence-visible, no document writes).
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.documentName - `presentation:<id>`
 * @param {Object} opts.user - authenticated user
 * @returns {Promise<{ presentationId: string, readOnly: boolean }>}
 */
export async function authorizeDocument({ repoRoot, documentName, user }) {
  const presentationId = presentationIdFromDocumentName(documentName);
  if (!presentationId) throw httpError('Unknown collab document', 404);
  if (!user?.email) throw httpError('Unauthorized', 401);

  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) throw httpError('Presentation not found', 404);

  const collaboratorPermission = await getCollaboratorPermission(
    presentationId,
    user.email,
    {}
  );
  if (!canReadPresentation({ user, pres, collaboratorPermission }))
    throw httpError('Forbidden', 403);

  const readOnly = !canWritePresentation({
    user,
    pres,
    collaboratorPermission,
  });
  return { presentationId, readOnly };
}
