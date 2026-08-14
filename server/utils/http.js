import fs from 'node:fs/promises';
import path from 'node:path';
import { isAppError, getStatusCode, errorToResponse } from './errors.js';
import { logError } from './logger.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

/**
 * Maximum accepted request-body size in bytes. Bounds memory use so an
 * authenticated client can't OOM the server with an unbounded body. Generous
 * default (25 MB) covers large decks with inline data-URL images; override with
 * MAX_REQUEST_BODY_BYTES. See docs/reference/security-posture.md
 * § Request-body size cap.
 */
const DEFAULT_MAX_BODY_BYTES = 25 * 1024 * 1024;

export function maxRequestBodyBytes() {
  const raw = process.env.MAX_REQUEST_BODY_BYTES;
  if (raw == null || raw === '') return DEFAULT_MAX_BODY_BYTES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BODY_BYTES;
}

/**
 * Read a request body into a Buffer, aborting once the byte cap is exceeded.
 * Throws an Error with statusCode 413 when the body is too large (the
 * top-level handler maps that to a 413 response).
 *
 * This is the layer under `requireJsonBody` and the only reader for bodies that
 * are *not* JSON — currently just the `.deck` bundle upload. Route handlers
 * that expect JSON use `requireJsonBody`, never this.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
export async function readRequestBody(req) {
  const limit = maxRequestBodyBytes();
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const err = new Error(
        `Request body too large (limit ${limit} bytes)`
      );
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * A parsed JSON body that is a plain object — the shape a route handler assumes
 * the moment it reads `body.field`. Excludes `null` (which is also
 * `typeof 'object'`) and arrays.
 *
 * @param {*} value
 * @returns {boolean}
 */
export function isJsonObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The single JSON body entry point for route handlers.
 *
 * It owns the whole HTTP contract rather than leaving pieces to the call site:
 * `400` on an empty, unparseable, or non-object body, `413` on one over
 * `maxRequestBodyBytes()`, each in the canonical error envelope. When it
 * answers `{ ok: false }` the response has already been sent — the handler just
 * returns.
 *
 * A successful result guarantees `body` is a plain object, so handlers read
 * `body.field` without re-checking `typeof body`. There is no opt-out: an
 * internal `/api/*` body is a `{...}` object, always (B55 removed the last
 * bare-array endpoints, the slide-library tag PUTs, which now take
 * `{ tags: [...] }`).
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Object} [opts]
 * @param {boolean} [opts.allowEmpty] Treat an empty body as `{}` instead of a
 *   400. For endpoints where "no payload" is a legitimate request (a toggle, a
 *   DELETE with optional options). Invalid JSON is still a 400 — an empty body
 *   is an absent payload, a broken one is a broken request.
 * @returns {Promise<{ok: true, body: *}|{ok: false}>}
 */
export async function requireJsonBody(req, res, { allowEmpty = false } = {}) {
  let raw;
  try {
    raw = (await readRequestBody(req)).toString('utf8');
  } catch (err) {
    if (err?.statusCode === 413) {
      payloadTooLarge(res, 'Request body too large');
    } else {
      badRequest(res, 'Failed to read request body');
    }
    return { ok: false };
  }

  if (!raw.trim()) {
    if (allowEmpty) return { ok: true, body: {} };
    badRequest(res, 'Request body is required');
    return { ok: false };
  }

  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    badRequest(res, 'Invalid JSON body');
    return { ok: false };
  }

  if (!isJsonObject(body)) {
    badRequest(res, 'Request body must be a JSON object');
    return { ok: false };
  }

  return { ok: true, body };
}

export function ok(res, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

export function serveJson(res, status, obj, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(obj, null, 2));
}

/**
 * Emit the canonical error envelope for internal (`/api/*`) routes:
 * `{ ok: false, error: '<machine_code>', message?: '<human>', details?: ... }`.
 *
 * `error` is always a stable snake_case machine code clients branch on; the
 * optional `message` carries human-readable text for display. This unifies the
 * two envelopes that used to coexist (prose-in-`error` from the helpers below
 * vs `{ ok:false, error:'code' }` from routes). The public `/api/v1/*` surface
 * keeps its own openapi-documented shape and does not use this.
 *
 * @param {import('node:http').ServerResponse} res
 * @param {number} status - HTTP status code.
 * @param {string} code - Machine-readable snake_case error code.
 * @param {string} [message] - Human-readable message (optional).
 * @param {Object} [opts]
 * @param {*} [opts.details] - Structured extra detail (echoed as `details`).
 * @param {Object} [opts.headers] - Extra response headers (e.g. Retry-After).
 * @returns {true}
 */
export function jsonError(res, status, code, message, { details, headers } = {}) {
  const body = { ok: false, error: code };
  if (message != null && message !== '') body.message = message;
  if (details != null) body.details = details;
  serveJson(res, status, body, headers || {});
  return true;
}

export function badRequest(res, message) {
  return jsonError(res, 400, 'bad_request', message || 'Bad request');
}

export function unauthorized(res, message = 'Unauthorized') {
  return jsonError(res, 401, 'unauthorized', message);
}

export function notFound(res, message = 'Not found') {
  return jsonError(res, 404, 'not_found', message);
}

export function forbidden(res, message = 'Forbidden') {
  return jsonError(res, 403, 'forbidden', message);
}

export function rateLimited(res, retryAfter = 5, message = 'Rate limit exceeded') {
  return jsonError(res, 429, 'rate_limited', message, {
    headers: { 'Retry-After': String(retryAfter) },
  });
}

export function serverError(res, message = 'Internal server error') {
  return jsonError(res, 500, 'internal_error', message);
}

export function payloadTooLarge(res, message = 'Request body too large') {
  return jsonError(res, 413, 'payload_too_large', message);
}

export function noContent(res) {
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
  return true;
}

/**
 * Standard mapping of error reason codes to HTTP status codes.
 * Consolidates duplicated statusMap objects across route handlers.
 */
const ERROR_STATUS_MAP = {
  // Not found errors
  not_found: 404,
  share_link_not_found: 404,

  // Gone (resource no longer available)
  revoked: 410,
  expired: 410,
  share_link_expired: 410,
  max_uses_exceeded: 410,

  // Authentication errors
  password_required: 401,
  invalid_password: 401,

  // Permission errors
  forbidden: 403,
  not_invited: 403,

  // Rate limiting
  rate_limited: 429,

  // Conflict (the resource is already in the requested state, or refuses the
  // transition: a second vote, an invite that already went out, a closed poll)
  already_exists: 409,
  already_voted: 409,
  already_invited: 409,
  closed: 409,

  // Bad request — the caller sent something we cannot act on
  invalid: 400,
  invalid_email: 400,
  invalid_permission: 400,
  user_not_found: 400,

  // Ours, not the caller's. These must never answer 4xx: telling a client its
  // request is malformed when our insert failed sends it off to fix something
  // that is not broken, and hides the outage from every error dashboard that
  // watches 5xx.
  database_error: 500,
  unavailable: 503,
};

/**
 * Get HTTP status code for an error reason.
 *
 * Pass `500` as the default on any surface whose reasons can be server-side:
 * an unrecognised reason is our vocabulary failing, not the caller's request.
 *
 * @param {string} reason - Error reason code
 * @param {number} defaultStatus - Default status if reason not mapped (default: 400)
 * @returns {number} HTTP status code
 */
export function getErrorStatus(reason, defaultStatus = 400) {
  // `hasOwn`, not truthiness: a bare property read would answer `Object`'s
  // inherited members (`constructor`, `toString`) with a function.
  return Object.hasOwn(ERROR_STATUS_MAP, reason) ? ERROR_STATUS_MAP[reason] : defaultStatus;
}

export function methodNotAllowed(res, allowed) {
  return jsonError(res, 405, 'method_not_allowed', 'Method not allowed', {
    headers: { Allow: allowed.join(', ') },
  });
}

/**
 * Serve a file from disk with safe content-type and security headers.
 * @param {import('node:http').ServerResponse} res
 * @param {string} absolutePath
 * @param {Object} [opts]
 * @param {boolean} [opts.userUpload] When true the file is user-uploaded
 *   content: risky types (SVG) are served inert (CSP sandbox +
 *   Content-Disposition: attachment) so a stored <script> can't execute in the
 *   app origin on navigation. See docs/reference/security-posture.md
 *   § User-uploaded content is served inert.
 */
export async function serveFile(res, absolutePath, { userUpload = false } = {}) {
  try {
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) return notFound(res);
    const ext = path.extname(absolutePath).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';
    const buf = await fs.readFile(absolutePath);

    const headers = {
      'Content-Type': ct,
      'Cache-Control': 'no-store',
      // Never let the browser MIME-sniff a response into an executable type.
      'X-Content-Type-Options': 'nosniff',
    };

    // User-uploaded SVG is stored XSS bait: served same-origin as
    // image/svg+xml it executes embedded <script> on direct navigation.
    // Serve it inert — the sandbox CSP blocks scripts and attachment stops
    // it rendering as a top-level document. Inline <img>/CSS use is unaffected.
    if (userUpload && ext === '.svg') {
      headers['Content-Security-Policy'] =
        "default-src 'none'; style-src 'unsafe-inline'; sandbox";
      headers['Content-Disposition'] = 'attachment';
    }

    res.writeHead(200, headers);
    res.end(buf);
  } catch {
    notFound(res);
  }
}

/**
 * Wrap an async route handler with standardized error handling.
 * Catches errors and returns appropriate HTTP responses using the error classes.
 *
 * @param {string} moduleName - Module name for logging (e.g., 'admin-users')
 * @param {Function} handler - Async route handler function
 * @returns {Function} Wrapped handler with error handling
 *
 * @example
 * export const handleUsers = withErrorHandler('users', async (ctx) => {
 *   const users = await listUsers();
 *   serveJson(ctx.res, 200, { users });
 *   return true;
 * });
 */
export function withErrorHandler(moduleName, handler) {
  return async (ctx, ...args) => {
    try {
      return await handler(ctx, ...args);
    } catch (err) {
      const { res } = ctx;

      // Log with consistent format, with the request context the old
      // per-route catches carried (method + path).
      const reqCtx = [ctx?.req?.method, ctx?.url?.pathname].filter(Boolean).join(' ');
      logError(moduleName, reqCtx ? `Error handling ${reqCtx}:` : 'Error:', err);

      // Handle already-sent headers (e.g., SSE streams)
      if (res.headersSent || res.writableEnded) {
        try {
          res.end();
        } catch {
          // Ignore close errors
        }
        return true;
      }

      // Use AppError status codes and responses (already the canonical envelope)
      if (isAppError(err)) {
        serveJson(res, err.statusCode, err.toJSON());
        return true;
      }

      // Handle errors with statusCode property (from other sources)
      const statusCode = getStatusCode(err);

      // Don't leak internal error details on 500 errors
      if (statusCode >= 500) {
        jsonError(res, statusCode, 'internal_error', 'Internal server error');
      } else {
        serveJson(res, statusCode, errorToResponse(err));
      }

      return true;
    }
  };
}

