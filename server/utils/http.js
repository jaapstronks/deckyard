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
 * MAX_REQUEST_BODY_BYTES. See docs/plans/security-hardening.md item 5a.
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

export async function json(req) {
  const raw = (await readRequestBody(req)).toString('utf8');
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON body');
  }
}

/**
 * Parse JSON from request body with configurable error handling.
 * Reduces boilerplate try-catch blocks in route handlers.
 *
 * @param {Object} req - HTTP request object
 * @param {Object} options - Configuration options
 * @param {boolean} options.required - If true, returns badRequest on empty/invalid body (default: false)
 * @param {*} options.defaultValue - Value to return on parse failure (default: null)
 * @param {Object} res - HTTP response (required if options.required is true)
 * @returns {Promise<{ok: boolean, body: *, error?: string}>} Parsed result
 */
export async function parseJsonBody(req, { required = false, defaultValue = null } = {}) {
  let raw;
  try {
    raw = (await readRequestBody(req)).toString('utf8');
  } catch (err) {
    if (err?.statusCode === 413) {
      return {
        ok: false,
        body: defaultValue,
        error: 'Request body too large',
        statusCode: 413,
      };
    }
    return { ok: false, body: defaultValue, error: 'Failed to read request body' };
  }

  if (!raw || !raw.trim()) {
    if (required) {
      return { ok: false, body: defaultValue, error: 'Request body is required' };
    }
    return { ok: true, body: defaultValue };
  }

  try {
    const body = JSON.parse(raw);
    return { ok: true, body };
  } catch {
    return { ok: false, body: defaultValue, error: 'Invalid JSON body' };
  }
}

/**
 * Parse JSON and send badRequest response on failure.
 * Convenience function for the common pattern of requiring valid JSON.
 *
 * @param {Object} req - HTTP request object
 * @param {Object} res - HTTP response object
 * @returns {Promise<{ok: true, body: *}|{ok: false}>} Result with body on success, or ok:false if error response was sent
 */
export async function requireJsonBody(req, res) {
  const result = await parseJsonBody(req, { required: true });
  if (!result.ok) {
    if (result.statusCode === 413) {
      payloadTooLarge(res, result.error);
    } else {
      badRequest(res, result.error);
    }
    return { ok: false };
  }
  return result;
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
  permission_denied: 403,
  not_invited: 403,

  // Rate limiting
  rate_limited: 429,

  // Bad request
  invalid_email: 400,
};

/**
 * Get HTTP status code for an error reason.
 * @param {string} reason - Error reason code
 * @param {number} defaultStatus - Default status if reason not mapped (default: 400)
 * @returns {number} HTTP status code
 */
export function getErrorStatus(reason, defaultStatus = 400) {
  return ERROR_STATUS_MAP[reason] || defaultStatus;
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
 *   app origin on navigation. See docs/plans/security-hardening.md item 4.
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

      // Log with consistent format
      logError(moduleName, 'Error:', err);

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

/**
 * Create an error handler for a specific module.
 * Returns a function that wraps handlers with that module's error logging.
 *
 * @param {string} moduleName - Module name for logging
 * @returns {Function} Handler wrapper function
 *
 * @example
 * const handle = createErrorHandler('collaborators');
 * export const listShared = handle(async (ctx) => { ... });
 * export const addCollab = handle(async (ctx) => { ... });
 */
export function createErrorHandler(moduleName) {
  return (handler) => withErrorHandler(moduleName, handler);
}
