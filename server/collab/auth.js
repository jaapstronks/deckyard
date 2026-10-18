/**
 * Authentication + authorization for the collaboration WebSocket endpoint.
 *
 * Reuses the exact same primitives as the REST routes: the sb_session cookie
 * (which the browser sends on a same-origin WebSocket upgrade) resolves to a
 * user via auth.js, and per-document access is the presentation service's
 * (`server/services/presentations.js`): only a user who may write the deck
 * connects at all.
 *
 * The Y.Doc is the author's document: it carries every field the editor
 * keeps, including the AI review notes per slide (B767), which the read
 * routes strip for readers. Every sync hands the whole document over, so
 * there is no read-only connection that would be safe; readers use the
 * filtered HTTP routes. The editor is the only client, and only users with
 * edit permission open it (`client/views/editor/index.js`).
 */

import { getUserFromRequestAsync } from '../auth/auth.js';
import { createStorageScope } from '../utils/context.js';
import {
  loadPresentationForActor,
  mayOnPresentation,
} from '../services/presentations.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../utils/errors.js';

/** Collab document names are `presentation:<id>` — one room per deck. */
export const COLLAB_DOC_PREFIX = 'presentation:';

/**
 * How long a connection's authorization holds (`lease.js`). Write permission
 * can end while the socket stays open; after this long, nothing more goes
 * out to the connection until a fresh check has passed, whether the client
 * sends anything or not. So a lost permission stops the document reaching a
 * user at most this long after the last successful check.
 */
export const COLLAB_AUTHORIZATION_LEASE_MS = 10_000;

/**
 * The cookie header of a WebSocket upgrade request.
 * crossws hands us a WHATWG-style Request proxy.
 *
 * @param {Request} request - upgrade request (crossws NodeReqProxy)
 * @returns {string}
 */
export function upgradeCookie(request) {
  return request?.headers?.get?.('cookie') || '';
}

/**
 * Resolve the user from a cookie header, the way every REST request does:
 * session signature and version, and in multi-organization mode the
 * membership the session acts in. auth.js expects a node-style req, so shim
 * the one header it reads.
 *
 * @param {string} cookie
 * @returns {Promise<Object|null>} user object or null when unauthenticated
 */
export async function authenticateCookie(cookie) {
  const user = await getUserFromRequestAsync({ headers: { cookie } });
  return user || null;
}

/**
 * Extract the presentation id from a collab document name.
 * The document name is arbitrary Yjs-protocol application data (a client can
 * open a provider with any name), and the extracted id flows into
 * `getPresentation` and other storage lookups that treat it as an opaque key.
 * Restrict the id to a safe charset so a name like
 * `presentation:../../../../etc/foo` is rejected as an unknown document
 * rather than reaching any lookup; real ids are uuids.
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
 * unless the user may write the presentation: the sync would hand a reader
 * the unfiltered author document.
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.documentName - `presentation:<id>`
 * @param {Object} opts.user - authenticated user
 * @returns {Promise<{ presentationId: string, organizationId: string|null }>}
 */
export async function authorizeDocument({ repoRoot, documentName, user }) {
  const presentationId = presentationIdFromDocumentName(documentName);
  if (!presentationId) throw new NotFoundError('Unknown collab document');
  if (!user?.email) throw new UnauthorizedError();

  const pres = await loadPresentationForActor(
    createStorageScope(user, { repoRoot }),
    { actor: user },
    presentationId,
  );
  if (!(await mayOnPresentation(pres, { actor: user }, 'write')))
    throw new ForbiddenError('Collab requires write permission');
  // The document's organization, so the persistence hooks — which run outside
  // any request — can write back into the organization the deck actually lives
  // in instead of the instance default.
  return {
    presentationId,
    organizationId: pres.organizationId ?? null,
  };
}

/**
 * Authorize a connection on a collab document: on every document it opens
 * (`onConnect`) and on every lease renewal (`lease.js`), through this one
 * decision. The user is resolved from the connection's cookie anew rather
 * than reused from the upgrade: Hocuspocus multiplexes documents over one
 * socket and hands each new one a copy of the upgrade context, so a session
 * revoked or an organization membership lost since then must count when the
 * next document opens, not only a change on the deck.
 *
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {string} opts.documentName - `presentation:<id>`
 * @param {{ user?: Object, cookie?: string }} opts.context - the
 *   connection's context; `user` is the identity of the upgrade, which the
 *   cookie must still resolve to
 * @returns {Promise<{ user: Object, organizationId: string|null }>} the user
 *   as resolved now, and the deck's organization
 * @throws {UnauthorizedError|ForbiddenError|NotFoundError}
 */
export async function authorizeConnection({ repoRoot, documentName, context }) {
  const user = await authenticateCookie(context?.cookie || '');
  if (!user?.email || user.email !== context?.user?.email)
    throw new UnauthorizedError();
  const { organizationId } = await authorizeDocument({
    repoRoot,
    documentName,
    user,
  });
  return { user, organizationId };
}
