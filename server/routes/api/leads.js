/**
 * Lead capture API routes.
 * Handles lead submission (public) and lead management (authenticated).
 */

import {
  badRequest,
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../utils/http.js';
import { getTrimmedString } from '../../utils/request-validators.js';
import { getClientIp, allowRequest } from '../../utils/rate-limit.js';
import { getPresentation } from '../../storage/presentations.js';
import { getCollaboratorPermission } from '../../storage/collaborators.js';
import { createRouteContext } from '../../utils/context.js';
import { canWritePresentation, canReadPresentation } from '../../utils/presentation-authz.js';
import { readAppSettings } from '../../storage/settings.js';
import {
  createLead,
  getLeadById,
  getLeadsForPresentation,
  getLeadCountForPresentation,
  getLeadsByEmail,
  exportLeadsAsCSV,
  anonymizeLead,
  anonymizeLeadsByEmail,
} from '../../storage/leads.js';
import { maybeFireLeadWebhook } from '../../utils/webhooks.js';
import { maybeSendLeadNotification } from '../../integrations/email/senders-leads.js';
import crypto from 'node:crypto';

// Rate limits for public lead submission.
// Token bucket: capacity = burst, refillPerSec = sustained rate. The limiter
// reads { capacity, refillPerSec }; the older { limit, windowMs } shape read as
// undefined/undefined and clamped every bucket to capacity 1 / 1 rps.
const LEAD_RATE_LIMITS = {
  perIp: { capacity: 10, refillPerSec: 0.167 }, // 10 burst, ~10 per minute per IP
  global: { capacity: 100, refillPerSec: 1.667 }, // 100 burst, ~100 per minute globally
};

// GDPR verification tokens (in-memory, short-lived)
// In production, use Redis or similar for multi-instance support
const gdprTokens = new Map();
const GDPR_TOKEN_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Handle public lead submission (no auth required).
 * POST /api/leads
 * @param {Object} ctx - Request context
 * @returns {Promise<boolean>} True if handled
 */
export async function handleLeadsPublic({ repoRoot, req, res, url }) {
  // POST /api/leads - Submit a lead (public)
  if (req.method === 'POST' && url.pathname === '/api/leads') {
    // Rate limit by IP
    const ip = getClientIp(req);
    if (!(await allowRequest(`leads:ip:${ip}`, LEAD_RATE_LIMITS.perIp))) {
      serveJson(res, 429, { ok: false, error: 'rate_limited' });
      return true;
    }
    if (!(await allowRequest('leads:global', LEAD_RATE_LIMITS.global))) {
      serveJson(res, 429, { ok: false, error: 'rate_limited' });
      return true;
    }

    const body = await json(req);
    if (!body) {
      return badRequest(res, 'Invalid request body'), true;
    }

    const presentationId = getTrimmedString(body, 'presentationId') || '';
    const slideId = getTrimmedString(body, 'slideId') || '';
    const name = getTrimmedString(body, 'name') || '';
    const email = (getTrimmedString(body, 'email') || '').toLowerCase();
    const consentGiven = body.consentGiven === true;
    const consentText = getTrimmedString(body, 'consentText') || '';
    const privacyUrl = getTrimmedString(body, 'privacyUrl') || '';

    if (!presentationId || !slideId) {
      return badRequest(res, 'Missing presentationId or slideId'), true;
    }
    if (!name || !email) {
      return badRequest(res, 'Name and email are required'), true;
    }
    if (!consentGiven || !consentText) {
      return badRequest(res, 'Consent is required'), true;
    }

    // Verify presentation exists
    const pres = await getPresentation(repoRoot, presentationId);
    if (!pres) {
      return notFound(res), true;
    }

    // Get app settings for retention period
    const settings = await readAppSettings(repoRoot);
    const retentionDays = settings?.leads?.retentionDays || 365;

    // Create the lead
    const result = await createLead({
      presentationId,
      slideId,
      name,
      email,
      consentText,
      privacyUrl: privacyUrl || null,
      ipAddress: ip,
      userAgent: req.headers['user-agent'] || null,
      organizationId: pres.organizationId || null,
      retentionDays,
    });

    if (!result.ok) {
      if (result.reason === 'invalid_email') {
        return badRequest(res, 'Invalid email address'), true;
      }
      return badRequest(res, result.reason || 'Failed to save lead'), true;
    }

    // Fire webhook (async, don't wait)
    maybeFireLeadWebhook(repoRoot, req, {
      presentation: pres,
      slideId,
      lead: result.lead,
    });

    // Send email notification to presentation owner (async, don't wait)
    maybeSendLeadNotification(repoRoot, {
      presentation: pres,
      lead: result.lead,
    });

    serveJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

/**
 * Handle authenticated leads routes.
 * @param {Object} ctx - Request context with authedUser
 * @returns {Promise<boolean>} True if handled
 */
export async function handleLeads(ctx) {
  const { req, url, authedUser } = ctx;
  const path = url.pathname;

  if (!authedUser) {
    return false; // Let api/index.js handle unauthorized
  }

  // ============================================================
  // PRESENTATION LEADS ENDPOINTS
  // ============================================================

  // GET /api/presentations/:id/leads
  const leadsMatch = path.match(/^\/api\/presentations\/([^/]+)\/leads$/);
  if (req.method === 'GET' && leadsMatch) {
    const presentationId = leadsMatch[1];
    return handleGetLeads(ctx, presentationId);
  }

  // GET /api/presentations/:id/leads/count
  const countMatch = path.match(/^\/api\/presentations\/([^/]+)\/leads\/count$/);
  if (req.method === 'GET' && countMatch) {
    const presentationId = countMatch[1];
    return handleGetLeadCount(ctx, presentationId);
  }

  // GET /api/presentations/:id/leads/export
  const exportMatch = path.match(/^\/api\/presentations\/([^/]+)\/leads\/export$/);
  if (req.method === 'GET' && exportMatch) {
    const presentationId = exportMatch[1];
    return handleExportLeads(ctx, presentationId);
  }

  // ============================================================
  // INDIVIDUAL LEAD ENDPOINTS
  // ============================================================

  // DELETE /api/leads/:id
  const deleteMatch = path.match(/^\/api\/leads\/([^/]+)$/);
  if (req.method === 'DELETE' && deleteMatch) {
    const leadId = deleteMatch[1];
    return handleDeleteLead(ctx, leadId);
  }

  // ============================================================
  // GDPR SELF-SERVICE ENDPOINTS
  // ============================================================

  // POST /api/leads/my-data/request - Request verification email
  if (req.method === 'POST' && path === '/api/leads/my-data/request') {
    return handleRequestMyData(ctx);
  }

  // GET /api/leads/my-data?email=xxx&token=xxx - Get my leads
  if (req.method === 'GET' && path === '/api/leads/my-data') {
    return handleGetMyData(ctx);
  }

  // DELETE /api/leads/my-data?email=xxx&token=xxx - Delete my leads
  if (req.method === 'DELETE' && path === '/api/leads/my-data') {
    return handleDeleteMyData(ctx);
  }

  return false;
}

// ============================================================
// HANDLER FUNCTIONS
// ============================================================

async function handleGetLeads(ctx, presentationId) {
  const { repoRoot, res, url, authedUser } = ctx;

  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) {
    return notFound(res), true;
  }

  // Check read permission
  const routeCtx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, routeCtx);
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res), true;
  }

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 100);
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  const slideId = url.searchParams.get('slideId') || null;

  const result = await getLeadsForPresentation(presentationId, {
    limit,
    offset,
    slideId,
  });

  serveJson(res, 200, {
    leads: result.leads,
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    hasMore: result.offset + result.leads.length < result.total,
  });
  return true;
}

async function handleGetLeadCount(ctx, presentationId) {
  const { repoRoot, res, authedUser } = ctx;

  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) {
    return notFound(res), true;
  }

  // Check read permission
  const routeCtx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, routeCtx);
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res), true;
  }

  const count = await getLeadCountForPresentation(presentationId);

  serveJson(res, 200, { count });
  return true;
}

async function handleExportLeads(ctx, presentationId) {
  const { repoRoot, res, url, authedUser } = ctx;

  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) {
    return notFound(res), true;
  }

  // Check write permission for export (more sensitive than read)
  const routeCtx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, routeCtx);
  }

  if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res), true;
  }

  const slideId = url.searchParams.get('slideId') || null;
  const result = await exportLeadsAsCSV(presentationId, { slideId });

  const filename = `leads-${presentationId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(result.csv);
  return true;
}

async function handleDeleteLead(ctx, leadId) {
  const { repoRoot, res, authedUser } = ctx;

  // Get the lead first to check permissions
  const lead = await getLeadById(leadId);
  if (!lead) {
    return notFound(res), true;
  }

  // Get the presentation to check permissions
  const pres = await getPresentation(repoRoot, lead.presentationId);
  if (!pres) {
    return notFound(res), true;
  }

  // Check write permission
  const routeCtx = createRouteContext(authedUser);
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email, routeCtx);
  }

  if (!canWritePresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res), true;
  }

  const result = await anonymizeLead(leadId);
  if (!result.ok) {
    return badRequest(res, result.reason || 'Failed to delete lead'), true;
  }

  serveJson(res, 200, { ok: true });
  return true;
}

async function handleRequestMyData(ctx) {
  const { req, res } = ctx;

  const body = await json(req);
  const email = (getTrimmedString(body, 'email') || '').toLowerCase();

  if (!email || !email.includes('@')) {
    return badRequest(res, 'Valid email required'), true;
  }

  // Generate a verification token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + GDPR_TOKEN_EXPIRY_MS;

  gdprTokens.set(email, { token, expiresAt });

  // Clean up expired tokens periodically
  for (const [e, v] of gdprTokens) {
    if (v.expiresAt < Date.now()) {
      gdprTokens.delete(e);
    }
  }

  // In a real implementation, send an email with the verification link
  // For now, return the token in development mode
  if (process.env.NODE_ENV === 'development') {
    serveJson(res, 200, {
      ok: true,
      message: 'Verification token generated',
      // Only include token in dev mode for testing
      devToken: token,
    });
  } else {
    // TODO: Send verification email
    serveJson(res, 200, {
      ok: true,
      message: 'If that email exists in our system, you will receive a verification link.',
    });
  }
  return true;
}

async function handleGetMyData(ctx) {
  const { url, res } = ctx;

  const email = url.searchParams.get('email')?.toLowerCase().trim();
  const token = url.searchParams.get('token');

  if (!email || !token) {
    return badRequest(res, 'Email and token required'), true;
  }

  // Verify token
  const stored = gdprTokens.get(email);
  if (!stored || stored.token !== token || stored.expiresAt < Date.now()) {
    return unauthorized(res, 'Invalid or expired token'), true;
  }

  const leads = await getLeadsByEmail(email);

  serveJson(res, 200, {
    email,
    leadCount: leads.length,
    leads: leads.map((l) => ({
      id: l.id,
      presentationId: l.presentationId,
      name: l.name,
      email: l.email,
      submittedAt: l.submittedAt,
      consentText: l.consentText,
    })),
  });
  return true;
}

async function handleDeleteMyData(ctx) {
  const { url, res } = ctx;

  const email = url.searchParams.get('email')?.toLowerCase().trim();
  const token = url.searchParams.get('token');

  if (!email || !token) {
    return badRequest(res, 'Email and token required'), true;
  }

  // Verify token
  const stored = gdprTokens.get(email);
  if (!stored || stored.token !== token || stored.expiresAt < Date.now()) {
    return unauthorized(res, 'Invalid or expired token'), true;
  }

  const result = await anonymizeLeadsByEmail(email);

  // Invalidate the token after use
  gdprTokens.delete(email);

  serveJson(res, 200, {
    ok: true,
    anonymized: result.anonymized,
  });
  return true;
}
