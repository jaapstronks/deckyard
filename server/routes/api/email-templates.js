/**
 * Admin API routes for email template management.
 * Allows admins to customize email templates per locale.
 */

import { getUserFromRequestAsync } from '../../auth/auth.js';
import { json, serveJson, badRequest, unauthorized, notFound } from '../../utils/http.js';
import { createRouteContext } from '../../utils/context.js';
import {
  readEmailTemplates,
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
  interpolatePlaceholders,
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

export async function handleEmailTemplates({ repoRoot, req, res, url }) {
  const ctx = createRouteContext(null);
  ctx.repoRoot = repoRoot;

  // Only handle /api/admin/email-templates routes
  if (!url.pathname.startsWith('/api/admin/email-templates')) {
    return false;
  }

  // All admin routes require authentication
  const user = await getUserFromRequestAsync(req, ctx);
  if (!user) {
    return unauthorized(res, 'Authentication required');
  }

  // All admin routes require admin role
  if (!user.isAdmin) {
    return unauthorized(res, 'Admin access required');
  }

  ctx.actorEmail = user.email;

  // ============================================================
  // GET /api/admin/email-templates - Get all templates with defaults + overrides
  // ============================================================
  if (url.pathname === '/api/admin/email-templates' && req.method === 'GET') {
    const templates = await getAllTemplates(repoRoot);
    serveJson(res, 200, templates);
    return true;
  }

  // ============================================================
  // GET /api/admin/email-templates/metadata - Get template metadata
  // ============================================================
  if (url.pathname === '/api/admin/email-templates/metadata' && req.method === 'GET') {
    serveJson(res, 200, {
      templates: TEMPLATE_METADATA,
      supportedLocales: SUPPORTED_LOCALES,
    });
    return true;
  }

  // ============================================================
  // PUT /api/admin/email-templates/settings - Update default locale
  // ============================================================
  if (url.pathname === '/api/admin/email-templates/settings' && req.method === 'PUT') {
    const body = await json(req);
    const locale = String(body?.defaultLocale || '').trim();

    if (!SUPPORTED_LOCALES.includes(locale)) {
      return badRequest(res, `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
    }

    const updated = await updateDefaultLocale(repoRoot, locale);
    serveJson(res, 200, { ok: true, defaultLocale: updated.defaultLocale });
    return true;
  }

  // ============================================================
  // PUT /api/admin/email-templates/:type/:locale - Update template for locale
  // ============================================================
  const updateMatch = url.pathname.match(/^\/api\/admin\/email-templates\/([^/]+)\/([^/]+)$/);
  if (updateMatch && req.method === 'PUT') {
    const type = updateMatch[1];
    const locale = updateMatch[2];

    // Validate type
    if (!TEMPLATE_METADATA[type]) {
      return badRequest(res, `Invalid template type. Valid types: ${Object.keys(TEMPLATE_METADATA).join(', ')}`);
    }

    // Validate locale
    if (!SUPPORTED_LOCALES.includes(locale)) {
      return badRequest(res, `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
    }

    const body = await json(req);
    const fields = {};

    // Extract allowed fields
    for (const field of TEMPLATE_METADATA[type].fields) {
      if (typeof body[field] === 'string') {
        fields[field] = body[field];
      }
    }

    try {
      await writeEmailTemplate(repoRoot, type, locale, fields);
      const resolved = await resolveTemplate(repoRoot, type, locale);
      serveJson(res, 200, { ok: true, template: resolved });
      return true;
    } catch (err) {
      return badRequest(res, err.message);
    }
  }

  // ============================================================
  // DELETE /api/admin/email-templates/:type/:locale - Reset to default
  // ============================================================
  if (updateMatch && req.method === 'DELETE') {
    const type = updateMatch[1];
    const locale = updateMatch[2];

    // Validate type
    if (!TEMPLATE_METADATA[type]) {
      return badRequest(res, `Invalid template type. Valid types: ${Object.keys(TEMPLATE_METADATA).join(', ')}`);
    }

    // Validate locale
    if (!SUPPORTED_LOCALES.includes(locale)) {
      return badRequest(res, `Invalid locale. Supported: ${SUPPORTED_LOCALES.join(', ')}`);
    }

    try {
      await deleteEmailTemplate(repoRoot, type, locale);
      const resolved = await resolveTemplate(repoRoot, type, locale);
      serveJson(res, 200, { ok: true, template: resolved });
      return true;
    } catch (err) {
      return badRequest(res, err.message);
    }
  }

  // ============================================================
  // POST /api/admin/email-templates/:type/preview - Preview with sample data
  // ============================================================
  const previewMatch = url.pathname.match(/^\/api\/admin\/email-templates\/([^/]+)\/preview$/);
  if (previewMatch && req.method === 'POST') {
    const type = previewMatch[1];

    // Validate type
    if (!TEMPLATE_METADATA[type]) {
      return badRequest(res, `Invalid template type. Valid types: ${Object.keys(TEMPLATE_METADATA).join(', ')}`);
    }

    const body = await json(req);
    const locale = String(body?.locale || 'en').trim();
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

  // ============================================================
  // POST /api/admin/email-templates/:type/test - Send test email to admin
  // ============================================================
  const testMatch = url.pathname.match(/^\/api\/admin\/email-templates\/([^/]+)\/test$/);
  if (testMatch && req.method === 'POST') {
    const type = testMatch[1];

    // Validate type
    if (!TEMPLATE_METADATA[type]) {
      return badRequest(res, `Invalid template type. Valid types: ${Object.keys(TEMPLATE_METADATA).join(', ')}`);
    }

    const body = await json(req);
    const locale = String(body?.locale || 'en').trim();
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

  return false;
}