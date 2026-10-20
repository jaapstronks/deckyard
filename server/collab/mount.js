/**
 * Real-time collaboration transport (Yjs / Hocuspocus).
 *
 * Mounts a Hocuspocus WebSocket endpoint on the existing HTTP server at
 * /collab, gated by COLLAB_ENABLED (default off: no upgrade handler, no
 * hocuspocus import, zero cost for single-user installs).
 *
 * Phase 1 scope: presence/awareness only. Clients exchange awareness states
 * (who is here, which slide they view, which field they focus); the Y.Doc
 * content is unused and nothing is persisted. Document persistence + live
 * edits are phase 2 (see docs/adr/001-realtime-collaboration.md).
 *
 * Follows the "mount another transport on the same port" precedent set by
 * the MCP SSE mount (server/server.js:/mcp).
 */

import {
  isCollabEnabled,
  isCollabLiveEditsEnabled,
} from '../config/features.js';
import { createLogger } from '../utils/logger.js';
import { isCollabOriginAllowed } from './origin.js';

const log = createLogger('collab');

/** URL path the WebSocket upgrade listens on. */
export const COLLAB_PATH = '/collab';

let active = null; // { hocuspocus, ws, authz, repoRoot }

/** Close event for a connection whose write permission ended. */
const FORBIDDEN_CLOSE = { code: 4403, reason: 'Forbidden' };

/**
 * The running Hocuspocus instance, or null when collab isn't mounted.
 * Used by the server-as-collaborator seam (live-apply.js) to reach actively
 * loaded documents.
 * @returns {Object|null}
 */
export function getActiveHocuspocus() {
  return active?.hocuspocus || null;
}

/**
 * Attach the collab WebSocket endpoint to an existing node:http server.
 * No-op (returns null) when COLLAB_ENABLED is off.
 *
 * @param {import('node:http').Server} server
 * @param {Object} opts
 * @param {string} opts.repoRoot
 * @param {number} [opts.authorizationLeaseMs] - How long a connection's
 *   authorization holds; `COLLAB_AUTHORIZATION_LEASE_MS` unless a test
 *   shortens it.
 * @returns {Promise<Object|null>} the Hocuspocus instance, or null
 */
export async function maybeAttachCollab(
  server,
  { repoRoot, authorizationLeaseMs },
) {
  if (!isCollabEnabled()) return null;
  if (active) return active.hocuspocus;

  // Lazy imports so disabled installs never load the dependency tree.
  const [
    { Hocuspocus },
    { default: crossws },
    authz,
    { attachAuthorizationLease },
  ] = await Promise.all([
    import('@hocuspocus/server'),
    import('crossws/adapters/node'),
    import('./auth.js'),
    import('./lease.js'),
  ]);

  // Phase 2 (COLLAB_LIVE_EDITS): document persistence. Without the flag the
  // Y.Doc stays ephemeral (presence-only) and nothing is ever stored.
  const liveEdits = isCollabLiveEditsEnabled();

  // A collab document belongs to exactly one deck, and therefore to exactly one
  // organization. The persistence hooks run outside any request, so they cannot
  // resolve it themselves — onConnect records it here (its authorization has the
  // deck in hand) and the hooks read it back. Cleared when the document unloads.
  const documentOrganizations = new Map();
  const documentScope = (documentName) => ({
    repoRoot,
    organizationId: documentOrganizations.get(documentName) ?? undefined,
  });

  let persistence = {};
  if (liveEdits) {
    const { createCollabPersistence } = await import('./persistence.js');
    persistence = createCollabPersistence({ repoRoot, documentScope });
  }

  // Write permission can end while a socket stays open, so each connection
  // sends behind an authorization lease (lease.js): once it runs out, the next
  // message in either direction waits for a fresh check, and a refusal closes
  // the connection. The check reads the session cookie again, so a revoked
  // session or a lost organization membership counts as well.
  const leaseMs = authorizationLeaseMs ?? authz.COLLAB_AUTHORIZATION_LEASE_MS;
  const leases = new WeakMap();
  const leaseOf = (connection) => {
    let lease = leases.get(connection);
    if (lease) return lease;
    const { context } = connection;
    lease = attachAuthorizationLease(connection, {
      ttlMs: leaseMs,
      authorizedAt: context.authorizedAt ?? 0,
      authorize: async () => {
        ({ user: context.user } = await authz.authorizeConnection({
          repoRoot,
          documentName: connection.document.name,
          context,
        }));
      },
      onRefused: () => connection.close(FORBIDDEN_CLOSE),
    });
    leases.set(connection, lease);
    connection.onClose(() => lease.dispose());
    return lease;
  };

  const hocuspocus = new Hocuspocus({
    quiet: true,
    // Debounce document stores (ADR 001 §5); flushed on last disconnect.
    ...(liveEdits ? { debounce: 2000, maxDebounce: 10000 } : {}),
    // Per-document authorization, for every document a socket opens. The
    // upgrade authenticated the socket (see below), but Hocuspocus gives each
    // new document a copy of that upgrade context, so the user is resolved
    // from the cookie again here, the same decision as a lease renewal: an
    // identity lost since the upgrade opens nothing. Only a writer connects
    // (auth.js). The stamp, taken before the check like a renewal's, starts
    // the connection's lease.
    async onConnect({ documentName, context }) {
      const authorizedAt = Date.now();
      const { user, organizationId } = await authz.authorizeConnection({
        repoRoot,
        documentName,
        context,
      });
      if (organizationId)
        documentOrganizations.set(documentName, organizationId);
      return { user, authorizedAt };
    },
    // Attach the lease as soon as the connection exists. Whichever of these
    // two runs first does it: Hocuspocus hands queued messages over before
    // it calls `connected`.
    async connected({ connection }) {
      leaseOf(connection);
    },
    async beforeHandleMessage({ connection }) {
      // A throw makes Hocuspocus close the connection before the message
      // applies; the refusal has closed it already.
      if (!(await leaseOf(connection).renew()))
        throw Object.assign(new Error('Forbidden'), FORBIDDEN_CLOSE);
    },
    ...persistence,
  });

  const ws = crossws({
    hooks: {
      // Runs during the HTTP upgrade, before the socket is established:
      // authenticate the session cookie or reject with a real 401 response.
      async upgrade(request) {
        const cookie = authz.upgradeCookie(request);
        const user = await authz.authenticateCookie(cookie);
        if (!user) return new Response('Unauthorized', { status: 401 });
        // The cookie stays with the connection: every lease renewal resolves
        // the user from it again.
        return { context: { user, cookie } };
      },
      open(peer) {
        peer._hocuspocus = hocuspocus.handleConnection(
          peer.websocket,
          peer.request,
          { user: peer.context?.user, cookie: peer.context?.cookie },
        );
      },
      message(peer, message) {
        peer._hocuspocus?.handleMessage(message.uint8Array());
      },
      close(peer, event) {
        peer._hocuspocus?.handleClose({
          code: event?.code,
          reason: event?.reason,
        });
      },
      error(peer, error) {
        log.error('websocket error:', error?.message || error);
      },
    },
  });

  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      // fall through to destroy below
    }
    if (pathname !== COLLAB_PATH) {
      // Not ours; nothing else handles upgrades, so close the socket.
      socket.destroy();
      return;
    }
    if (!isCollabOriginAllowed(req)) {
      socket.end(
        'HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n',
      );
      return;
    }
    ws.handleUpgrade(req, socket, head).catch((err) => {
      log.error('upgrade failed:', err?.message || err);
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    });
  });

  active = { hocuspocus, ws, authz, leaseOf };
  log.info(
    `${liveEdits ? 'presence + live-edits' : 'presence'} endpoint mounted at ${COLLAB_PATH}`,
  );
  return hocuspocus;
}

/**
 * Check every open connection on a deck's collab document again and close
 * the ones whose user may no longer write it. Called when a collaborator is
 * removed or their permission changes, so a demoted editor stops receiving
 * the author document now instead of when their lease runs out: each lease
 * is withdrawn first, so nothing goes out while the checks run.
 * No-op when collab isn't mounted or the document isn't loaded.
 *
 * @param {string} presentationId
 * @returns {Promise<number>} the number of connections closed
 */
export async function revalidateCollabAccess(presentationId) {
  if (!active) return 0;
  const { hocuspocus, authz, leaseOf } = active;
  const document = hocuspocus.documents.get(
    `${authz.COLLAB_DOC_PREFIX}${presentationId}`,
  );
  if (!document) return 0;
  const results = await Promise.all(
    document.getConnections().map((connection) => leaseOf(connection).check()),
  );
  return results.filter((ok) => !ok).length;
}

/** Close all collab connections (graceful shutdown). */
export async function shutdownCollab() {
  if (!active) return;
  const { hocuspocus } = active;
  active = null;
  try {
    hocuspocus.closeConnections();
    hocuspocus.flushPendingStores();
  } catch (err) {
    log.error('shutdown error:', err?.message || err);
  }
}
