/**
 * Lead capture API routes.
 * Handles lead submission (public) and lead management (authenticated).
 */

import { badRequest, notFound, serveJson, unauthorized, jsonError, requireJsonBody, withErrorHandler } from '../../utils/http.js';
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
import { maybeSendLeadNotification, sendDataRequestVerificationEmail } from '../../integrations/email/senders-leads.js';
import crypto from 'node:crypto';
import { crossOrganizationScope } from '../../storage/scope.js';
import { LEAD_RATE_LIMITS, GDPR_RATE_LIMITS, AUTH_RATE_LIMITS } from '../../config/rate-limits.js';
import {
  storeGdprToken,
  verifyGdprToken,
  consumeGdprToken,
  deleteExpiredGdprTokens,
} from '../../storage/gdpr-tokens.js';

// GDPR verification tokens live in the `gdpr_verification_tokens` DB table
// (see server/storage/gdpr-tokens.js) — durable across restarts and scale-out,
// the same shape as the analytics track-erase token.
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
 *
 * The three `my-data` self-service routes are public on purpose: the data
 * subject is an anonymous visitor with no account, and the emailed
 * `crypto.randomBytes(32)` token — not a session — is the proof of identity.
 * They sit before the authed `DELETE /api/leads/:id` in the mount order, so the
 * literal `DELETE /api/leads/my-data` is matched here and never resolves as
 * `leadId='my-data'`. This mirrors the public, token-gated anonymous erase at
 * `POST /api/track/my-data/erase` (`analytics-track.js`).
 * @type {import('../../utils/router.js').Route[]}
 */
export const PUBLIC_ROUTES = [
  { method: 'POST', pattern: '/api/leads', handler: handleLeadSubmit },
  { method: 'POST', pattern: '/api/leads/my-data/request', handler: handleRequestMyData },
  { method: 'GET', pattern: '/api/leads/my-data', handler: handleGetMyData },
  { method: 'DELETE', pattern: '/api/leads/my-data', handler: handleDeleteMyData },
];

/**
 * Handle public lead submission (no auth required).
 * @param {import('../../utils/context.js').PublicContext} ctx
 * @returns {Promise<boolean>} True if handled
 */
export const handleLeadsPublic = withErrorHandler('leads', async (ctx) => {
  return dispatchRoutes(PUBLIC_ROUTES, ctx);
});

/**
 * Authenticated lead routes: the three presentation-scoped reads, then
 * `DELETE /api/leads/:id`. The `my-data` self-service routes used to live here
 * ahead of the `:id` row to dodge the `:id`-swallows-`my-data` hazard; they are
 * now in `PUBLIC_ROUTES` (dispatched before this table), which removes the
 * hazard structurally — no literal remains for `:id` to shadow.
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/leads$/, handler: handleGetLeads },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/leads\/count$/, handler: handleGetLeadCount },
  { method: 'GET', pattern: /^\/api\/presentations\/([^/]+)\/leads\/export$/, handler: handleExportLeads },
  { method: 'DELETE', pattern: /^\/api\/leads\/([^/]+)$/, handler: handleDeleteLead },
];

/**
 * Handle authenticated leads routes.
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>} True if handled
 */
export const handleLeads = withErrorHandler('leads', async (ctx) => {
  if (!ctx.authedUser) {
    return false; // Let api/index.js handle unauthorized
  }
  return dispatchRoutes(ROUTES, ctx);
});

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
  const { req, res, repoRoot } = ctx;

  // This route is public and mails a token to any well-formed address, so it is
  // rate-limited on three axes. Per-IP + global cap the raw volume and are
  // checked before the body is read (mirrors the lead-submit handler); the
  // per-target-email bucket, checked once the address is known, is the bucket
  // that actually caps e-mail bombing of one address. Every refusal is the same
  // constant `rate_limited` 429 — a 429 must not reveal whether the address is
  // on file any more than the 200 path does.
  const ip = getClientIp(req);
  if (!(await allowRequest(`leads:mydata:ip:${ip}`, GDPR_RATE_LIMITS.perIp))) {
    return jsonError(res, 429, 'rate_limited'), true;
  }
  if (!(await allowRequest('leads:mydata:global', GDPR_RATE_LIMITS.global))) {
    return jsonError(res, 429, 'rate_limited'), true;
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const email = (getTrimmedString(body, 'email') || '').toLowerCase();

  if (!email || !email.includes('@')) {
    return badRequest(res, 'Valid email required'), true;
  }

  // Per-target-email throttle: keyed on the supplied address only (not on
  // whether leads exist for it), so it stays non-enumerable.
  if (!(await allowRequest(`leads:mydata:email:${email}`, GDPR_RATE_LIMITS.perEmail))) {
    return jsonError(res, 429, 'rate_limited'), true;
  }

  // Generate a verification token
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + GDPR_TOKEN_EXPIRY_MS;

  await storeGdprToken({ email, token, expiresAt });

  // Sweep expired tokens opportunistically (as the old in-memory store did).
  await deleteExpiredGdprTokens();

  // Deliver the token by e-mail. Note we always attempt delivery for any
  // well-formed address (no existence check) — that keeps the response the
  // same whether or not leads exist, so it can't be used to probe which
  // addresses are in the system. The request origin backs up BASE_URL so the
  // emailed link is absolute even on installs that never set it (same
  // derivation as the magic-link route).
  const host = req.headers?.host || 'localhost:3000';
  const protocol = req.headers?.['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const result = await sendDataRequestVerificationEmail({
    email,
    token,
    requestOrigin: `${protocol}://${host}`,
    repoRoot,
  });

  if (result.ok) {
    serveJson(res, 200, {
      ok: true,
      message: 'If that email exists in our system, you will receive a verification link.',
    });
    return true;
  }

  if (result.reason === 'not_configured') {
    // No outgoing mail on this install: don't claim a link was sent. In
    // development we echo the token instead so the flow stays testable
    // without a mail provider; production answers an honest 501, the same
    // shape as the email test-send and Notion routes.
    if (process.env.NODE_ENV === 'development') {
      serveJson(res, 200, {
        ok: true,
        message: 'Verification token generated (development: email is not configured)',
        devToken: token,
      });
      return true;
    }
    return (
      jsonError(
        res,
        501,
        'email_not_configured',
        'Outgoing email is not configured on this install (BREVO_API_KEY)'
      ),
      true
    );
  }

  // The request was valid; the upstream provider failed. That is a 502, the
  // same mapping the email test-send route uses for provider failures.
  return jsonError(res, 502, 'internal_error', `Failed to send verification email: ${result.error}`), true;
}

async function handleGetMyData(ctx) {
  const { req, url, res } = ctx;

  // Destructive-adjacent and public: gate token-guessing with the strict
  // expensive-op tier keyed by IP (no principal here), like the track-erase.
  const ip = getClientIp(req);
  if (!(await allowRequest(`leads:mydata:view:${ip}`, AUTH_RATE_LIMITS.expensive))) {
    return jsonError(res, 429, 'rate_limited'), true;
  }

  const email = url.searchParams.get('email')?.toLowerCase().trim();
  const token = url.searchParams.get('token');

  if (!email || !token) {
    return badRequest(res, 'Email and token required'), true;
  }

  // Verify token (constant-time compare inside the store)
  if (!(await verifyGdprToken({ email, token }))) {
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
  const { req, url, res } = ctx;

  // Same strict IP-keyed expensive-op tier as the read (and the track-erase):
  // the token is the real gate, this only caps brute-forcing it.
  const ip = getClientIp(req);
  if (!(await allowRequest(`leads:mydata:erase:${ip}`, AUTH_RATE_LIMITS.expensive))) {
    return jsonError(res, 429, 'rate_limited'), true;
  }

  const email = url.searchParams.get('email')?.toLowerCase().trim();
  const token = url.searchParams.get('token');

  if (!email || !token) {
    return badRequest(res, 'Email and token required'), true;
  }

  // Verify token (constant-time compare inside the store)
  if (!(await verifyGdprToken({ email, token }))) {
    return unauthorized(res, 'Invalid or expired token'), true;
  }

  const result = await anonymizeLeadsByEmail(email);

  // Burn the token after use
  await consumeGdprToken(email);

  serveJson(res, 200, {
    ok: true,
    anonymized: result.anonymized,
  });
  return true;
}
