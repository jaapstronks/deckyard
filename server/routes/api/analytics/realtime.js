/**
 * Real-time analytics SSE endpoint.
 */

import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { ANALYTICS_CONFIG } from '../../../analytics/helpers.js';
import { getActiveViewerCount } from '../../../storage/analytics/view-sessions.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('realtime');

// Active SSE connections for real-time viewer count
const activeConnections = new Map();

/**
 * GET /api/presentations/:id/analytics/realtime - SSE for live viewer count.
 */
export async function handleRealtime(ctx, presentationId) {
  const { req, res, authedUser } = ctx;

  const pres = await withPresentationAuth({
    repoRoot: ctx.repoRoot,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Send initial count
  const initialCount = await getActiveViewerCount(presentationId);
  res.write(`event: viewerCount\ndata: ${JSON.stringify({ count: initialCount })}\n\n`);

  // Set up interval for updates (using configurable interval)
  const intervalId = setInterval(async () => {
    try {
      const count = await getActiveViewerCount(presentationId);
      res.write(`event: viewerCount\ndata: ${JSON.stringify({ count })}\n\n`);
    } catch (err) {
      // Log error but don't crash the connection
      log.error('[analytics] SSE update error:', err.message);
    }
  }, ANALYTICS_CONFIG.SSE_UPDATE_INTERVAL_MS);

  // Track connection
  const connectionId = `${presentationId}-${Date.now()}`;
  activeConnections.set(connectionId, { presentationId, intervalId });

  // Cleanup function
  function cleanup() {
    clearInterval(intervalId);
    clearTimeout(timeoutId);
    activeConnections.delete(connectionId);
  }

  // Maximum connection timeout (using configurable timeout) - prevent zombie connections
  const timeoutId = setTimeout(() => {
    log.info(`[analytics] SSE connection timeout: ${connectionId}`);
    cleanup();
    try {
      res.end();
    } catch (err) {
      // Connection may already be closed
    }
  }, ANALYTICS_CONFIG.SSE_TIMEOUT_MS);

  // Clean up on close
  req.on('close', cleanup);

  return true;
}

/**
 * Get the number of active SSE connections.
 */
export function getActiveConnectionCount() {
  return activeConnections.size;
}
