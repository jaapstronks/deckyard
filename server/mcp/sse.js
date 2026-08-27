/**
 * MCP SSE Transport — Server-Sent Events transport for remote MCP access.
 *
 * Implements the MCP Streamable HTTP transport (2025-03-26 spec):
 * - POST /mcp  → JSON-RPC request/response + optional SSE streaming
 * - GET  /mcp  → SSE stream for server-initiated messages (future)
 * - DELETE /mcp → Close session
 *
 * Authentication via Bearer token (Deckyard API keys: dk_live_*). The key is
 * revalidated on every request; its permissions and quota are enforced per
 * tool call in ./authorization.js, against the same counters `/api/v1` uses.
 *
 * This module exports a handler function to be mounted on the main
 * Deckyard HTTP server — no separate process needed.
 */

import { randomUUID } from 'node:crypto';
import { validateApiKey } from '../storage/api-keys.js';
import { openSseStream, sseWrite } from '../utils/sse.js';

// ─── Constants ───────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes idle timeout
const MAX_SESSIONS = 1000;
const KEEPALIVE_INTERVAL_MS = 30_000; // SSE keepalive every 30s

// ─── Session store ───────────────────────────────────────────────────────

/** @type {Map<string, Session>} */
const sessions = new Map();

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} ownerEmail
 * @property {string} keyId - API key ID this session was opened with; the
 *   session only remembers who it belongs to. Permissions, tier and quota are
 *   read off the freshly validated key on every request, so a key that is
 *   downgraded or revoked loses its reach immediately instead of at session
 *   expiry.
 * @property {number} createdAt
 * @property {number} lastActiveAt
 * @property {import('node:http').ServerResponse|null} sseResponse - Active SSE stream (if any)
 * @property {(() => void)|null} closeSse
 */

function createSession(apiKey) {
  const session = {
    id: randomUUID(),
    ownerEmail: apiKey.ownerEmail,
    // A machine client acts in the organization its key belongs to.
    organizationId: apiKey.organizationId ?? null,
    keyId: apiKey.id,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    sseResponse: null,
    closeSse: null,
  };
  sessions.set(session.id, session);
  return session;
}

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (Date.now() - session.lastActiveAt > SESSION_TTL_MS) {
    destroySession(sessionId);
    return null;
  }
  session.lastActiveAt = Date.now();
  return session;
}

function destroySession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  session.closeSse?.();
  if (session.sseResponse) {
    try {
      session.sseResponse.end();
    } catch {
      /* ignore */
    }
  }
  sessions.delete(sessionId);
}

/**
 * Destroy every expired MCP session, once. Scheduled from `server.js` via
 * `jobs/mcp-session-sweep.js` — no module-load timer here.
 * @returns {number} How many sessions were destroyed.
 */
export function sweepExpiredMcpSessions() {
  const now = Date.now();
  let destroyed = 0;
  for (const [id, session] of sessions) {
    if (now - session.lastActiveAt > SESSION_TTL_MS) {
      destroySession(id);
      destroyed += 1;
    }
  }
  return destroyed;
}

// ─── Auth ────────────────────────────────────────────────────────────────

/**
 * Extract and validate Bearer token from request.
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<{ok: boolean, apiKey?: Object, reason?: string}>}
 */
async function authenticate(req) {
  const auth = req.headers?.authorization || '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return { ok: false, reason: 'missing_auth' };
  }

  const token = auth.slice(7).trim();
  if (!token) return { ok: false, reason: 'missing_auth' };

  const result = await validateApiKey(token);
  if (!result.ok) return { ok: false, reason: result.reason };

  // Check for the 'read' permission minimum (all MCP requests need at least read)
  return { ok: true, apiKey: result };
}

// ─── Request body parsing ────────────────────────────────────────────────

function readBody(req, limit = 1_048_576) {
  // 1MB limit
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ─── Main handler ────────────────────────────────────────────────────────

/**
 * Create an MCP SSE transport handler.
 *
 * @param {import('./protocol.js').McpServer} server - The MCP server instance
 * @param {Object} [options]
 * @param {string} [options.basePath='/mcp'] - URL path to mount on
 * @returns {Function} HTTP request handler: (req, res, url) => Promise<boolean>
 */
export function createSseHandler(server, options = {}) {
  const basePath = options.basePath || '/mcp';

  /**
   * Handle an incoming HTTP request.
   * @param {Object} ctx - { req, res, url, repoRoot }
   * @returns {Promise<boolean>} true if handled, false to pass through
   */
  return async function handleMcpSse({ req, res, url }) {
    // Only handle our path
    if (url.pathname !== basePath) return false;

    const method = req.method?.toUpperCase();

    // ─── CORS preflight ──────────────────────────────────────────
    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          'Authorization, Content-Type, Mcp-Session-Id',
        'Access-Control-Expose-Headers': 'Mcp-Session-Id',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return true;
    }

    // CORS headers for all responses
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

    // ─── POST /mcp — JSON-RPC request ────────────────────────────
    if (method === 'POST') {
      return await handlePost(server, req, res, basePath);
    }

    // ─── GET /mcp — SSE stream for server-initiated messages ─────
    if (method === 'GET') {
      return await handleGet(req, res);
    }

    // ─── DELETE /mcp — Close session ─────────────────────────────
    if (method === 'DELETE') {
      return await handleDelete(req, res);
    }

    // Method not allowed
    res.writeHead(405, { Allow: 'GET, POST, DELETE, OPTIONS' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return true;
  };
}

// ─── POST handler (main RPC) ─────────────────────────────────────────────

async function handlePost(server, req, res, basePath) {
  // Authenticate
  const auth = await authenticate(req);
  if (!auth.ok) {
    const status = auth.reason === 'unavailable' ? 503 : 401;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32000,
          message:
            auth.reason === 'unavailable'
              ? 'Authentication service unavailable'
              : 'Unauthorized — provide a valid API key via Bearer token',
        },
      }),
    );
    return true;
  }

  // Parse request body
  let body;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: ' + err.message },
      }),
    );
    return true;
  }

  // Session management
  const sessionId = req.headers['mcp-session-id'];
  let session;

  if (body.method === 'initialize') {
    // New session — create one
    if (sessions.size >= MAX_SESSIONS) {
      // Evict oldest session
      let oldest = null;
      for (const s of sessions.values()) {
        if (!oldest || s.lastActiveAt < oldest.lastActiveAt) oldest = s;
      }
      if (oldest) destroySession(oldest.id);
    }
    session = createSession(auth.apiKey);
  } else if (sessionId) {
    session = getSession(sessionId);
    if (!session) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: {
            code: -32000,
            message:
              'Session expired or invalid. Send initialize to start a new session.',
          },
        }),
      );
      return true;
    }
    // Verify same API key owner
    if (session.ownerEmail !== auth.apiKey.ownerEmail) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: {
            code: -32000,
            message: 'Session belongs to a different API key owner',
          },
        }),
      );
      return true;
    }
  } else if (body.method !== 'initialize') {
    // No session and not initializing — stateless mode
    // Allow single request/response without session (simpler for basic use)
    session = null;
  }

  // Build per-request context for tool handlers. The acting key is carried
  // whole so the scope/quota gate in ./authorization.js judges the key that
  // authenticated *this* request, not a copy frozen at session start.
  const context = {
    ownerEmail: session?.ownerEmail || auth.apiKey.ownerEmail,
    apiKey: {
      id: auth.apiKey.id,
      tier: auth.apiKey.tier || 'free',
      permissions: auth.apiKey.permissions,
    },
    transport: 'sse',
  };

  // Handle JSON-RPC (single or batch)
  const isBatch = Array.isArray(body);
  const messages = isBatch ? body : [body];
  const responses = [];

  for (const msg of messages) {
    const response = await server.handleMessage(msg, context);
    if (response) {
      responses.push(JSON.parse(response));
    }
  }

  // Build response
  const headers = { 'Content-Type': 'application/json' };
  if (session) {
    headers['Mcp-Session-Id'] = session.id;
  }

  if (isBatch) {
    res.writeHead(200, headers);
    res.end(JSON.stringify(responses));
  } else if (responses.length === 1) {
    res.writeHead(200, headers);
    res.end(JSON.stringify(responses[0]));
  } else {
    // Notification — no response body
    res.writeHead(202, headers);
    res.end();
  }

  return true;
}

// ─── GET handler (SSE stream) ────────────────────────────────────────────

async function handleGet(req, res) {
  // Authenticate
  const auth = await authenticate(req);
  if (!auth.ok) {
    const status = auth.reason === 'unavailable' ? 503 : 401;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return true;
  }

  // Require session
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error:
          'Missing Mcp-Session-Id header. POST an initialize request first.',
      }),
    );
    return true;
  }

  const session = getSession(sessionId);
  if (!session) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found or expired' }));
    return true;
  }

  // Close existing SSE stream if any
  if (session.sseResponse) {
    try {
      session.sseResponse.end();
    } catch {
      /* ignore */
    }
    session.closeSse?.();
  }

  // Start SSE stream. Guard opt-out: this endpoint is bearer-authenticated
  // and sessions carry their own TTL sweep, so the public-stream connection
  // caps don't apply. `no-transform` on top of the canonical set: MCP
  // responses must not be recoded by intermediaries.
  const stream = openSseStream(req, res, {
    guard: false,
    heartbeatMs: KEEPALIVE_INTERVAL_MS,
    cacheControl: 'no-cache, no-transform',
    onClose: () => {
      session.sseResponse = null;
      session.closeSse = null;
    },
  });

  session.sseResponse = res;
  session.closeSse = stream.close;

  // Send initial connected event
  sseWrite(res, {
    event: 'endpoint',
    data: { type: 'session', status: 'connected', sessionId: session.id },
  });

  return true;
}

// ─── DELETE handler (close session) ──────────────────────────────────────

async function handleDelete(req, res) {
  const auth = await authenticate(req);
  if (!auth.ok) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return true;
  }

  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing Mcp-Session-Id header' }));
    return true;
  }

  const session = getSession(sessionId);
  if (session && session.ownerEmail === auth.apiKey.ownerEmail) {
    destroySession(sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Session closed' }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
  }

  return true;
}

// ─── Info/status ─────────────────────────────────────────────────────────

/**
 * Get SSE transport status (for health checks / debugging).
 */
export function getSseStatus() {
  return {
    activeSessions: sessions.size,
    maxSessions: MAX_SESSIONS,
    sessionTtlMs: SESSION_TTL_MS,
  };
}
