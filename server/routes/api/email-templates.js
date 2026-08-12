/**
 * Admin API routes for email template management.
 * Allows admins to customize email templates per locale.
 */

import { serveJson, badRequest, unauthorized, requireJsonBody } from '../../utils/http.js';
import { getTrimmedString, getOptionalString } from '../../utils/request-validators.js';
import { dispatchRoutes } from '../../utils/router.js';
import {
  writeEmailTemplate,
  deleteEmailTemplate,
  updateDefaultLocale,
  TEMPLATE_METADATA,
  SUPPORTED_LOCALES,
} from '../../storage/email-templates.js';
import {
  getAllTemplates,
  generatePreview,
  resolveTemplate,
} from '../../integrations/email-template-resolver.js';
import { sendEmail } from '../../integrations/brevo.js';
import { EMAIL_STYLES, emailWrapper, emailButton, troubleClickingFooter } from '../../integrations/email-templates.js';
import { escapeHtml } from '../../../shared/slide-types/helpers.js';

/**
 * Build a sample email HTML for preview/test.
 * @param {Object} preview - Preview data from generatePreview
 * @returns {string} HTML content
 */
function buildPreviewHtml(preview) {
  const body = `
    <p>${preview.body}</p>
    ${emailButton('#preview-button-url', preview.buttonLabel)}
    <p style="${EMAIL_STYLES.mutedSmall}">${escapeHtml(preview.footer)}</p>
  `;

  return emailWrapper({
    greeting: preview.greeting,
    body,
    footer: troubleClickingFooter('#preview-button-url'),
  });
}

// GET /api/admin/email-templates - Get all templates with defaults + overrides
async function handleEmailTemplateList({ repoRoot, res }) {
  const templates = await getAllTemplates(repoRoot);
  serveJson(res, 200, templates);
  return true;
}

// GET /api/admin/email-templates/metadata - Get template metadata
function handleEmailTemplateMetadata({ res }) {
  serveJson(res, 200, {
    templates: TEMPLATE_METADATA,
    supportedLocales: SUPPORTED_LOCALES,
  });
  return true;
}

// PUT /api/admin/email-templates/settings - Update default locale
async function handleEmailTemplateSettings({ storageScope, req, res }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const locale = getTrimmedString(body, 'defaultLocale') || '';

  if (!SUPPORTED_LOCALES.includes(locale)) {
    return badRequest(res, `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
  }

  const updated = await updateDefaultLocale(storageScope, locale);
  serveJson(res, 200, { ok: true, defaultLocale: updated.defaultLocale });
  return true;
}

// PUT /api/admin/email-templates/:type/:locale - Update template for locale
async function handleEmailTemplateWrite({ repoRoot, storageScope, req, res }, type, locale) {
  // Validate type
  if (!TEMPLATE_METADATA[type]) {
    return badRequest(res, `Invalid template type. Valid types: ${Object.keys(TEMPLATE_METADATA).join(', ')}`);
  }

  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale)) {
    return badRequest(res, `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const fields = {};

  // Extract allowed fields
  for (const field of TEMPLATE_METADATA[type].fields) {
    const value = getOptionalString(body, field);
    if (value !== null) {
      fields[field] = value;
    }
  }

  try {
    await writeEmailTemplate(storageScope, type, locale, fields);
    const resolved = await resolveTemplate(repoRoot, type, locale);
    serveJson(res, 200, { ok: true, template: resolved });
    return true;
  } catch (err) {
    return badRequest(res, err.message);
  }
}

// DELETE /api/admin/email-templates/:type/:locale - Reset to default
async function handleEmailTemplateReset({ repoRoot, storageScope, res }, type, locale) {
  // Validate type
  if (!TEMPLATE_METADATA[type]) {
    return badRequest(res, `Invalid template type. Valid types: ${Object.keys(TEMPLATE_METADATA).join(', ')}`);
  }

  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale)) {
    return badRequest(res, `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
  }

  try {
    await deleteEmailTemplate(storageScope, type, locale);
    const resolved = await resolveTemplate(repoRoot, type, locale);
    serveJson(res, 200, { ok: true, template: resolved });
    return true;
  } catch (err) {
    return badRequest(res, err.message);
  }
}

// POST /api/admin/email-templates/:type/preview - Preview with sample data
async function handleEmailTemplatePreview({ repoRoot, req, res }, type) {
  // Validate type
  if (!TEMPLATE_METADATA[type]) {
    return badRequest(res, `Invalid template type. Valid types: ${Object.keys(TEMPLATE_METADATA).join(', ')}`);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const locale = getTrimmedString(body, 'locale') || 'en';
  const customFields = body?.fields || null;

  if (!SUPPORTED_LOCALES.includes(locale)) {
    return badRequest(res, `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
  }

  try {
    const preview = await generatePreview(repoRoot, type, locale, customFields);
    const htmlContent = buildPreviewHtml(preview);

    serveJson(res, 200, {
      ok: true,
      preview: {
        ...preview,
        htmlContent,
      },
    });
    return true;
  } catch (err) {
    return badRequest(res, err.message);
  }
}

// POST /api/admin/email-templates/:type/test - Send test email to admin
async function handleEmailTemplateTest({ repoRoot, req, res, authedUser: user }, type) {
  // Validate type
  if (!TEMPLATE_METADATA[type]) {
    return badRequest(res, `Invalid template type. Valid types: ${Object.keys(TEMPLATE_METADATA).join(', ')}`);
  }

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const locale = getTrimmedString(body, 'locale') || 'en';
  const customFields = body?.fields || null;

  if (!SUPPORTED_LOCALES.includes(locale)) {
    return badRequest(res, `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
  }

  try {
    const preview = await generatePreview(repoRoot, type, locale, customFields);
    const htmlContent = buildPreviewHtml(preview);

    // Send test email to the admin
    const result = await sendEmail({
      to: user.email,
      toName: user.name || user.email,
      subject: `[TEST] ${preview.subject}`,
      htmlContent,
    });

    if (!result.ok) {
      return badRequest(res, `Failed to send test email: ${result.error}`);
    }

    serveJson(res, 200, {
      ok: true,
      message: `Test email sent to ${user.email}`,
    });
    return true;
  } catch (err) {
    return badRequest(res, err.message);
  }
}

/**
 * Declarative route table for `/api/admin/email-templates*` (A7.19 C8). Order
 * matches the previous if-chain — in particular, the `:type/:locale` PUT row
 * comes before the `:type/preview` POST row, so `PUT …/x/preview` still
 * resolves as a template write with an invalid locale (400), exactly as
 * before. Every path fell through on a method mismatch (Form A), so there are
 * no 405 catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: '/api/admin/email-templates', handler: handleEmailTemplateList },
  { method: 'GET', pattern: '/api/admin/email-templates/metadata', handler: handleEmailTemplateMetadata },
  { method: 'PUT', pattern: '/api/admin/email-templates/settings', handler: handleEmailTemplateSettings },
  { method: 'PUT', pattern: /^\/api\/admin\/email-templates\/([^/]+)\/([^/]+)$/, handler: handleEmailTemplateWrite },
  { method: 'DELETE', pattern: /^\/api\/admin\/email-templates\/([^/]+)\/([^/]+)$/, handler: handleEmailTemplateReset },
  { method: 'POST', pattern: /^\/api\/admin\/email-templates\/([^/]+)\/preview$/, handler: handleEmailTemplatePreview },
  { method: 'POST', pattern: /^\/api\/admin\/email-templates\/([^/]+)\/test$/, handler: handleEmailTemplateTest },
];

/**
 * Handle admin email-template routes. The module-wide guards (path prefix,
 * authentication, admin role) run before dispatch, exactly as the original
 * chain did.
 *
 * Mounted after the auth gate in routes/api/index.js, so the user is already
 * resolved and enriched on the context — it is not re-resolved here. Email
 * templates are stored per-instance (file-backed, not organization-scoped), so
 * these routes need the caller's identity but no storage scope.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleEmailTemplates(ctx) {
  // Only handle /api/admin/email-templates routes
  if (!ctx.url.pathname.startsWith('/api/admin/email-templates')) {
    return false;
  }

  if (!ctx.authedUser) {
    return unauthorized(ctx.res, 'Authentication required');
  }

  // All admin routes require admin role
  if (!ctx.authedUser.isAdmin) {
    return unauthorized(ctx.res, 'Admin access required');
  }

  return dispatchRoutes(ROUTES, ctx);
}