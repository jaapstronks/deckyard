/**
 * Real-time analytics SSE endpoint.
 */

import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { ANALYTICS_CONFIG } from '../../../analytics/helpers.js';
import { getActiveViewerCount } from '../../../storage/analytics/index.js';
import { openSseStream, sseWrite } from '../../../utils/sse.js';
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
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  // Declared before the stream opens: the client can leave during the first
  // await below, and onClose must then find nothing to stop, not a TDZ.
  const connectionId = `${presentationId}-${Date.now()}`;
  let intervalId = null;
  let timeoutId = null;
  function cleanup() {
    clearInterval(intervalId);
    clearTimeout(timeoutId);
    activeConnections.delete(connectionId);
  }

  const stream = openSseStream(req, res, { onClose: cleanup });
  if (!stream.ok) return true;

  // Send initial count
  const initialCount = await getActiveViewerCount(presentationId);
  // A client that left during the count is gone: start no timers for it.
  if (stream.signal.aborted) return true;
  sseWrite(res, { event: 'viewerCount', data: { count: initialCount } });

  // Set up interval for updates (using configurable interval)
  intervalId = setInterval(async () => {
    try {
      const count = await getActiveViewerCount(presentationId);
      sseWrite(res, { event: 'viewerCount', data: { count } });
    } catch (err) {
      // Log error but don't crash the connection
      log.error('[analytics] SSE update error:', err.message);
    }
  }, ANALYTICS_CONFIG.SSE_UPDATE_INTERVAL_MS);

  // Track connection
  activeConnections.set(connectionId, { presentationId, intervalId });

  // Maximum connection timeout (using configurable timeout) - prevent zombie
  // connections. The handler ends the stream itself, so it closes it first:
  // onClose is for the client leaving, not for us hanging up.
  timeoutId = setTimeout(() => {
    log.info(`[analytics] SSE connection timeout: ${connectionId}`);
    cleanup();
    stream.close();
    try {
      res.end();
    } catch (err) {
      // Connection may already be closed
    }
  }, ANALYTICS_CONFIG.SSE_TIMEOUT_MS);

  return true;
}
