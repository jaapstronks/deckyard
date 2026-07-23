import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  CLIENT_DIR,
  SHARED_PUBLIC_DIRS,
  repoRoot,
} from './config/paths.js';
import { loadDotEnv } from './config/env.js';
import { authConfigError, authConfigWarnings } from './auth/auth.js';
import { publicUrlWarnings } from './config/utils.js';
import { handleApi } from './routes/api.js';
import { handleStatic } from './routes/static.js';
import { getFeatureFlags } from './config/feature-flags.js';
import { allowRequest, getClientIp } from './utils/rate-limit.js';
import { applySecurityHeaders } from './utils/security-headers.js';
import { buildTopLevelErrorBody } from './utils/error-response.js';
import { startSandboxCleanupLoop } from './utils/sandbox-cleanup.js';
import { dataDir, uploadsDir } from './config/storage-paths.js';
import { initializeStorage, closeStorage } from './storage/adapters/index.js';
import { initializeMediaProvider } from './media/index.js';
import { startHeartbeat, stopHeartbeat } from './services/comment-events.js';
import { scheduleAuthCleanup } from './jobs/auth-cleanup.js';
import { scheduleDigestEmailJob } from './jobs/digest-email.js';
import { scheduleAnalyticsCleanup } from './jobs/analytics-cleanup.js';
import { initSanitizer } from '../shared/sanitize.js';
import { closeRedis } from './utils/redis-client.js';
import { initializeQueues, closeQueues } from './jobs/queue/connection.js';
import { initializeWorkers } from './jobs/queue/workers/index.js';
import { handleMcpSse } from './mcp/sse-mount.js';
import { maybeAttachCollab, shutdownCollab } from './collab/mount.js';

function getUrl(req) {
  const host = req.headers.host || 'localhost';
  return new URL(req.url || '/', `http://${host}`);
}

async function ensureDirs() {
  const d = dataDir(repoRoot);
  await fs.mkdir(path.join(d, 'presentations'), { recursive: true });
  await fs.mkdir(path.join(d, 'published'), { recursive: true });
  await fs.mkdir(path.join(d, 'polls'), { recursive: true });
  await fs.mkdir(uploadsDir(repoRoot), { recursive: true });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = getUrl(req);

    // Baseline security headers on every response. Set via setHeader() so they
    // merge into each handler's writeHead() without any route changes
    // (security-audit H8). /embed/* stays frameable for Notion/iframe embeds.
    applySecurityHeaders(req, res, url.pathname);

    // Health check endpoint for uptime monitoring (no auth, minimal dependencies)
    if (url.pathname === '/health') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      return;
    }

    // Demo/sandbox guardrails (best-effort): rate limit sensitive endpoints.
    const flags = getFeatureFlags();
    if (flags.demoMode || flags.sandboxMode) {
      const ip = getClientIp(req);
      const method = String(req.method || 'GET').toUpperCase();
      const p = url.pathname || '/';

      // Group by risk/cost.
      let group = null;
      if (p.startsWith('/api/presentations/') && p.includes('/export/'))
        group = 'export';
      else if (p === '/api/presentations' && method === 'POST')
        group = 'create';
      else if (p.startsWith('/api/presentations/') && method === 'PUT')
        group = 'update';
      else if (p.startsWith('/api/presentations/') && p.endsWith('/publish'))
        group = 'publish';
      else if (p.startsWith('/api/follow/') && method === 'POST')
        group = 'follow_post';

      const LIMITS = {
        export: { capacity: 8, refillPerSec: 0.25 }, // ~15/min
        publish: { capacity: 6, refillPerSec: 0.2 }, // ~12/min
        create: { capacity: 6, refillPerSec: 0.2 }, // ~12/min
        update: { capacity: 30, refillPerSec: 1 }, // ~60/min
        follow_post: { capacity: 20, refillPerSec: 1 }, // ~60/min
      };

      if (group && LIMITS[group]) {
        const ok = await allowRequest(`${ip}:${group}`, LIMITS[group]);
        if (!ok) {
          res.writeHead(429, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          });
          res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
          return;
        }
      }
    }

    // MCP SSE transport (remote AI agent access)
    if (url.pathname === '/mcp') {
      const handled = await handleMcpSse({ req, res, url, repoRoot });
      if (handled) return;
    }

    if (url.pathname.startsWith('/api/'))
      return await handleApi({ repoRoot, req, res, url });
    return await handleStatic({
      repoRoot,
      req,
      res,
      url,
      clientDir: CLIENT_DIR,
      sharedPublicDirs: SHARED_PUBLIC_DIRS,
    });
  } catch (err) {
    const status = Number(err?.statusCode || 500);
    const payload = JSON.stringify(buildTopLevelErrorBody(status, err), null, 2);

    // Important for streaming endpoints (SSE): headers may already be sent.
    if (!res.headersSent && !res.writableEnded) {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(payload);
      return;
    }

    // Best-effort close without trying to write headers again.
    try {
      res.end();
    } catch {}
  }
});

await loadDotEnv(repoRoot);

// Security check: warn if AUTH_DEV_BYPASS is enabled in production
if (process.env.NODE_ENV === 'production') {
  const devBypass = String(process.env.AUTH_DEV_BYPASS || '').trim().toLowerCase();
  if (devBypass === '1' || devBypass === 'true' || devBypass === 'yes') {
    console.error(
      '\n⚠️  SECURITY WARNING: AUTH_DEV_BYPASS is enabled in production!\n' +
      '   This allows passwordless admin access. Set AUTH_DEV_BYPASS=false immediately.\n'
    );
    process.exit(1);
  }
}

// Security check: refuse to fail OPEN. A missing AUTH_SECRET makes auth fall
// back to anonymous admin; that is only allowed when auth is explicitly
// disabled (AUTH_ENABLED=false) or in sandbox/demo mode. See security 3b.
{
  const authErr = authConfigError();
  if (authErr) {
    console.error(`\n⚠️  SECURITY: ${authErr}\n`);
    process.exit(1);
  }
}

// Non-fatal configuration warnings (weak secret, missing public URL). These
// don't block boot but should be fixed before exposing the instance.
for (const w of [...authConfigWarnings(), ...publicUrlWarnings()]) {
  console.warn(`⚠️  CONFIG: ${w}`);
}

await ensureDirs();
await initializeStorage(repoRoot);
await initializeMediaProvider(repoRoot);
await initSanitizer(); // Enable sync HTML sanitization for markdown rendering
startSandboxCleanupLoop(repoRoot);
startHeartbeat(); // SSE heartbeat for real-time comment updates
const authCleanupJob = scheduleAuthCleanup(); // Clean expired tokens hourly
const digestEmailJob = scheduleDigestEmailJob({ repoRoot }); // Weekly digest emails
const analyticsCleanupJob = scheduleAnalyticsCleanup(); // Clean old analytics daily

// Initialize background job queue (Redis-based, with fallback)
await initializeQueues();
await initializeWorkers();

// Real-time collaboration (presence) WebSocket endpoint, gated by COLLAB_ENABLED
await maybeAttachCollab(server, { repoRoot });

const PORT = Number(process.env.PORT || 4177);
const HOST = process.env.HOST || '127.0.0.1';
server.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error(
    `Server failed to start (${String(
      err?.code || 'ERR'
    )}): ${String(err?.message || err)}`
  );
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(
    `Slide Deck Builder running at http://${HOST}:${PORT}`
  );
});

// Graceful shutdown
async function shutdown(signal) {
  console.log(`\n[Server] Received ${signal}, shutting down...`);
  stopHeartbeat(); // Stop SSE heartbeat
  await shutdownCollab(); // Close collab WebSocket connections
  authCleanupJob.stop(); // Stop auth cleanup job
  digestEmailJob.stop(); // Stop digest email job
  analyticsCleanupJob.stop(); // Stop analytics cleanup job
  server.close(async () => {
    await closeQueues(); // Close job queues and workers
    await closeStorage();
    await closeRedis(); // Close Redis connection
    console.log('[Server] Shutdown complete');
    process.exit(0);
  });
  // Force exit after 10s if graceful shutdown hangs
  setTimeout(() => {
    console.error('[Server] Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));