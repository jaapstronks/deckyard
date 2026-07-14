/**
 * Admin API routes for AI validation logs.
 * Allows admins to view, download, and analyze AI validation events.
 */

import { getUserFromRequestAsync } from '../../auth/auth.js';
import { serveJson, unauthorized, notFound, badRequest } from '../../utils/http.js';
import {
  getValidationLogs,
  getValidationSummary,
  listLogFiles,
  downloadLogFile,
  cleanupOldLogs,
} from '../../utils/ai/validation-logging.js';

export async function handleAdminAiLogs({ repoRoot, req, res, url }) {
  // Only handle /api/admin/ai-logs routes
  if (!url.pathname.startsWith('/api/admin/ai-logs')) {
    return false;
  }

  // All admin routes require authentication
  const user = await getUserFromRequestAsync(req, { repoRoot, req });
  if (!user) {
    return unauthorized(res, 'Authentication required');
  }

  // All admin routes require admin role
  if (!user.isAdmin) {
    return unauthorized(res, 'Admin access required');
  }

  // ============================================================
  // GET /api/admin/ai-logs - List log files
  // ============================================================
  if (url.pathname === '/api/admin/ai-logs' && req.method === 'GET') {
    const files = listLogFiles();
    serveJson(res, 200, { files });
    return true;
  }

  // ============================================================
  // GET /api/admin/ai-logs/summary - Get validation summary
  // ============================================================
  if (url.pathname === '/api/admin/ai-logs/summary' && req.method === 'GET') {
    const startDate = url.searchParams.get('startDate') || undefined;
    const endDate = url.searchParams.get('endDate') || undefined;

    const summary = getValidationSummary({ startDate, endDate });
    serveJson(res, 200, summary);
    return true;
  }

  // ============================================================
  // GET /api/admin/ai-logs/entries - Get log entries
  // ============================================================
  if (url.pathname === '/api/admin/ai-logs/entries' && req.method === 'GET') {
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

  // ============================================================
  // GET /api/admin/ai-logs/download/:filename - Download a log file
  // ============================================================
  const downloadMatch = url.pathname.match(/^\/api\/admin\/ai-logs\/download\/(.+)$/);
  if (downloadMatch && req.method === 'GET') {
    const filename = downloadMatch[1];
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

  // ============================================================
  // POST /api/admin/ai-logs/cleanup - Force cleanup of old logs
  // ============================================================
  if (url.pathname === '/api/admin/ai-logs/cleanup' && req.method === 'POST') {
    const deleted = cleanupOldLogs();
    serveJson(res, 200, { deleted, message: `Cleaned up ${deleted} old log files` });
    return true;
  }

  return false;
}
