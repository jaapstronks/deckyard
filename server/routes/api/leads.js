/**
 * Lead capture API routes.
 * Handles lead submission (public) and lead management (authenticated).
 */

import { badRequest, notFound, serveJson, unauthorized, jsonError, requireJsonBody } from '../../utils/http.js';
import { dispatchRoutes } from '../../utils/router.js';
import { getTrimmedString } from '../../utils/request-validators.js';
import { getClientIp, allowRequest } from '../../utils/rate-limit.js';
import { getPresentation } from '../../storage/presentations/index.js';
import { getCollaboratorPermission } from '../../storage/collaborators.js';
import { canWritePresentation, canReadPresentation } from '../../utils/presentation-authz.js';
import { getAppSettings } from '../../storage/settings.js';
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
import { crossOrganizationScope } from '../../storage/scope.js';

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
 * POST /api/leads - Submit a lead (public).
 */
async function handleLeadSubmit({ repoRoot, req, res }) {
  // Rate limit by IP
  const ip = getClientIp(req);
  if (!(await allowRequest(`leads:ip:${ip}`, LEAD_RATE_LIMITS.perIp))) {
    jsonError(res, 429, 'rate_limited');
    return true;
  }
  if (!(await allowRequest('leads:global', LEAD_RATE_LIMITS.global))) {
    jsonError(res, 429, 'rate_limited');
    return true;
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
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

  // Verify presentation exists. Lead capture happens on a published deck, so
  // the viewer has no session and the deck must not be organization-filtered.
  const pres = await getPresentation(
    crossOrganizationScope(repoRoot, 'lead capture from a published deck'),
    presentationId
  );
  if (!pres) {
    return notFound(res), true;
  }

  // Get app settings for retention period
  const settings = await getAppSettings(
    crossOrganizationScope(repoRoot, 'public lead submission: retention period is instance-level')
  );
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

/**
 * Public lead-capture routes (mounted before the auth gate).
 * @type {import('../../utils/router.js').Route[]}
 */
export const PUBLIC_ROUTES = [
  { method: 'POST', pattern: '/api/leads', handler: handleLeadSubmit },
];

/**
 * Handle public lead submission (no auth required).
 * @param {import('../../utils/context.js').PublicContext} ctx
 * @returns {Promise<boolean>} True if handled
 */
export async function handleLeadsPublic(ctx) {
  return dispatchRoutes(PUBLIC_ROUTES, ctx);
}

/**
 * Authenticated lead routes: the three presentation-scoped reads, then the
 * GDPR self-service paths, then `DELETE /api/leads/:id`. The literal
 * `my-data` rows must precede the `:id` row — `:id` matches any segment, so
 * the reverse order would resolve `DELETE /api/leads/my-data` as
 * `leadId='my-data'` and the erasure handler would never run.
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/leads$/, handler: handleGetLeads },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/leads\/count$/, handler: handleGetLeadCount },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/leads\/export$/, handler: handleExportLeads },
  { method: 'POST', pattern: '/api/leads/my-data/request', handler: handleRequestMyData },
  { method: 'GET', pattern: '/api/leads/my-data', handler: handleGetMyData },
  { method: 'DELETE', pattern: '/api/leads/my-data', handler: handleDeleteMyData },
  { method: 'DELETE', pattern: /^\/api\/leads\/([^/]+)$/, handler: handleDeleteLead },
];

/**
 * Handle authenticated leads routes.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>} True if handled
 */
export async function handleLeads(ctx) {
  if (!ctx.authedUser) {
    return false; // Let api/index.js handle unauthorized
  }
  return dispatchRoutes(ROUTES, ctx);
}

// ============================================================
// HANDLER FUNCTIONS
// ============================================================

async function handleGetLeads(ctx, presentationId) {
  const { storageScope, res, url, authedUser } = ctx;

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) {
    return notFound(res), true;
  }

  // Check read permission
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email);
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
  const { storageScope, res, authedUser } = ctx;

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) {
    return notFound(res), true;
  }

  // Check read permission
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email);
  }

  if (!canReadPresentation({ user: authedUser, pres, collaboratorPermission })) {
    return unauthorized(res), true;
  }

  const count = await getLeadCountForPresentation(presentationId);

  serveJson(res, 200, { count });
  return true;
}

async function handleExportLeads(ctx, presentationId) {
  const { storageScope, res, url, authedUser } = ctx;

  const pres = await getPresentation(storageScope, presentationId);
  if (!pres) {
    return notFound(res), true;
  }

  // Check write permission for export (more sensitive than read)
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email);
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
  const { storageScope, res, authedUser } = ctx;

  // Get the lead first to check permissions
  const lead = await getLeadById(leadId);
  if (!lead) {
    return notFound(res), true;
  }

  // Get the presentation to check permissions
  const pres = await getPresentation(storageScope, lead.presentationId);
  if (!pres) {
    return notFound(res), true;
  }

  // Check write permission
  let collaboratorPermission = null;
  if (authedUser?.email && pres?.id) {
    collaboratorPermission = await getCollaboratorPermission(pres.id, authedUser.email);
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

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
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
