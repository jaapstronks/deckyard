/**
 * Admin API routes for AI validation logs.
 * Allows admins to view, download, and analyze AI validation events.
 */

import {
  serveJson,
  unauthorized,
  notFound,
  badRequest,
  withErrorHandler,
  forbidden,
} from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import {
  getValidationLogs,
  getValidationSummary,
  listLogFiles,
  downloadLogFile,
  cleanupOldLogs,
} from '../../utils/ai/validation-logging.js';

// GET /api/admin/ai-logs - List log files
function handleAiLogsList({ res }) {
  const files = listLogFiles();
  serveJson(res, 200, { files });
  return true;
}

// GET /api/admin/ai-logs/summary - Get validation summary
function handleAiLogsSummary({ res, url }) {
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;

  const summary = getValidationSummary({ startDate, endDate });
  serveJson(res, 200, summary);
  return true;
}

// GET /api/admin/ai-logs/entries - Get log entries
function handleAiLogsEntries({ res, url }) {
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;
  const eventType = url.searchParams.get('eventType') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '1000', 10);

  if (limit > 10000) {
    return badRequest(res, 'Limit cannot exceed 10000');
  }

  const entries = getValidationLogs({ startDate, endDate, eventType, limit });
  serveJson(res, 200, { entries, count: entries.length });
  return true;
}

// GET /api/admin/ai-logs/download/:filename - Download a log file
function handleAiLogsDownload({ res }, filename) {
  const content = downloadLogFile(filename);

  if (!content) {
    return notFound(res, 'Log file not found');
  }

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(content);
  return true;
}

// POST /api/admin/ai-logs/cleanup - Force cleanup of old logs
function handleAiLogsCleanup({ res }) {
  const deleted = cleanupOldLogs();
  serveJson(res, 200, {
    deleted,
    message: `Cleaned up ${deleted} old log files`,
  });
  return true;
}

/**
 * Declarative route table for `/api/admin/ai-logs*` (A7.19 C8). Order matches
 * the previous if-chain; every path fell through on a method mismatch (Form A),
 * so there are no 405 catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/admin/ai-logs', handler: handleAiLogsList },
  {
    method: 'GET',
    pattern: '/api/admin/ai-logs/summary',
    handler: handleAiLogsSummary,
  },
  {
    method: 'GET',
    pattern: '/api/admin/ai-logs/entries',
    handler: handleAiLogsEntries,
  },
  {
    method: 'GET',
    pattern: /^\/api\/admin\/ai-logs\/download\/(.+)$/,
    handler: handleAiLogsDownload,
  },
  {
    method: 'POST',
    pattern: '/api/admin/ai-logs/cleanup',
    handler: handleAiLogsCleanup,
  },
];

/**
 * Handle admin AI-log routes. The module-wide guards (path prefix,
 * authentication, admin role) run before dispatch, exactly as the original
 * chain did.
 *
 * Mounted after the auth gate in routes/api/index.js, so the user is already
 * resolved and enriched on the context — it is not re-resolved here.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export const handleAdminAiLogs = withErrorHandler('admin-ai-logs', (ctx) => {
  // Only handle /api/admin/ai-logs routes
  if (!ctx.url.pathname.startsWith('/api/admin/ai-logs')) {
    return false;
  }

  if (!ctx.authedUser) {
    return unauthorized(ctx.res, 'Authentication required');
  }

  // All admin routes require admin role
  if (!ctx.authedUser.isAdmin) {
    return forbidden(ctx.res, 'Admin access required');
  }

  return dispatchRoutes(ROUTES, ctx);
});
