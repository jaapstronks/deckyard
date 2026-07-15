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

import { isCollabEnabled } from '../config/features.js';

/** URL path the WebSocket upgrade listens on. */
export const COLLAB_PATH = '/collab';

let active = null; // { hocuspocus, ws }

/**
 * Attach the collab WebSocket endpoint to an existing node:http server.
 * No-op (returns null) when COLLAB_ENABLED is off.
 *
 * @param {import('node:http').Server} server
 * @param {{ repoRoot: string }} opts
 * @returns {Promise<Object|null>} the Hocuspocus instance, or null
 */
export async function maybeAttachCollab(server, { repoRoot }) {
  if (!isCollabEnabled()) return null;
  if (active) return active.hocuspocus;

  // Lazy imports so disabled installs never load the dependency tree.
  const [{ Hocuspocus }, { default: crossws }, authz] = await Promise.all([
    import('@hocuspocus/server'),
    import('crossws/adapters/node'),
    import('./auth.js'),
  ]);

  const hocuspocus = new Hocuspocus({
    quiet: true,
    // Per-document authorization. The user was already authenticated on the
    // upgrade (see below) and rides in via the connection context.
    async onConnect({ documentName, context, connectionConfig }) {
      const { readOnly } = await authz.authorizeDocument({
        repoRoot,
        documentName,
        user: context?.user,
      });
      connectionConfig.readOnly = readOnly;
    },
  });

  const ws = crossws({
    hooks: {
      // Runs during the HTTP upgrade, before the socket is established:
      // authenticate the session cookie or reject with a real 401 response.
      async upgrade(request) {
        const user = await authz.authenticateUpgradeRequest(request);
        if (!user) return new Response('Unauthorized', { status: 401 });
        return { context: { user } };
      },
      open(peer) {
        peer._hocuspocus = hocuspocus.handleConnection(
          peer.websocket,
          peer.request,
          { user: peer.context?.user }
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
        console.error('[collab] websocket error:', error?.message || error);
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
    ws.handleUpgrade(req, socket, head).catch((err) => {
      console.error('[collab] upgrade failed:', err?.message || err);
      try {
        socket.destroy();
      } catch {
        // ignore
      }
    });
  });

  active = { hocuspocus, ws };
  console.log(`[collab] presence endpoint mounted at ${COLLAB_PATH}`);
  return hocuspocus;
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
    console.error('[collab] shutdown error:', err?.message || err);
  }
}
