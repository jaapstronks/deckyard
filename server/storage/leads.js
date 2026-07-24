/**
 * Lead submissions storage for capturing and managing leads from presentations.
 * Includes GDPR compliance features: consent tracking, retention, anonymization.
 */

import { norm, nowIso } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';

// GDPR compliance constants
const DEFAULT_RETENTION_DAYS = 365;
const MAX_RETENTION_DAYS = 730; // 2 years max per GDPR guidelines

// ============================================================
// CREATE
// ============================================================

/**
 * Create a new lead submission.
 * @param {Object} data - Lead data
 * @param {string} data.presentationId - The presentation ID
 * @param {string} data.slideId - The slide ID
 * @param {string} data.name - Lead's name
 * @param {string} data.email - Lead's email
 * @param {string} data.consentText - The consent text shown to the user
 * @param {string} [data.privacyUrl] - URL to privacy policy
 * @param {string} [data.ipAddress] - Client IP address
 * @param {string} [data.userAgent] - Client user agent
 * @param {string} [data.organizationId] - Organization ID
 * @param {number} [data.retentionDays] - Days to retain data (default 365)
 * @returns {Promise<{ok: boolean, lead?: Object, reason?: string}>}
 */
export async function createLead(data) {
  const presentationId = norm(data?.presentationId);
  const slideId = norm(data?.slideId);
  const name = String(data?.name || '').trim();
  const email = String(data?.email || '').toLowerCase().trim();
  const consentText = String(data?.consentText || '').trim();

  if (!presentationId || !slideId) {
    return { ok: false, reason: 'invalid_presentation' };
  }
  if (!name || !email) {
    return { ok: false, reason: 'invalid_contact' };
  }
  if (!consentText) {
    return { ok: false, reason: 'consent_required' };
  }
  // Basic email validation
  if (!email.includes('@') || email.length > 320) {
    return { ok: false, reason: 'invalid_email' };
  }

  const retentionDays = Math.max(1, Math.min(MAX_RETENTION_DAYS, data?.retentionDays || DEFAULT_RETENTION_DAYS));
  const retentionExpiresAt = new Date();
  retentionExpiresAt.setDate(retentionExpiresAt.getDate() + retentionDays);

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();

    const row = await db
      .insertInto('lead_submissions')
      .values({
        organization_id: data?.organizationId ?? null,
        presentation_id: presentationId,
        slide_id: slideId,
        name,
        email,
        consent_given: true,
        consent_text: consentText,
        privacy_url: data?.privacyUrl ?? null,
        ip_address: data?.ipAddress ?? null,
        user_agent: data?.userAgent ?? null,
        submitted_at: now,
        retention_expires_at: retentionExpiresAt.toISOString(),
        created_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      lead: rowToLead(row),
    };
  });
}

// ============================================================
// READ
// ============================================================

/**
 * Get a lead by ID.
 * @param {string} leadId - The lead ID
 * @returns {Promise<Object|null>}
 */
export async function getLeadById(leadId) {
  const id = norm(leadId);
  if (!id) return null;

  return withDbGuard(null, async (db) => {
    const row = await db
      .selectFrom('lead_submissions')
      .selectAll()
      .where('id', '=', id)
      .where('anonymized_at', 'is', null)
      .executeTakeFirst();

    if (!row) return null;
    return rowToLead(row);
  });
}

/**
 * Get leads for a presentation with pagination.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Query options
 * @param {number} [opts.limit] - Max results (default 50)
 * @param {number} [opts.offset] - Offset for pagination
 * @param {string} [opts.slideId] - Filter by slide ID
 * @returns {Promise<{leads: Object[], total: number, limit: number, offset: number}>}
 */
export async function getLeadsForPresentation(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return { leads: [], total: 0, limit: 50, offset: 0 };

  return withDbGuard({ leads: [], total: 0, limit: 50, offset: 0 }, async (db) => {
    let query = db
      .selectFrom('lead_submissions')
      .selectAll()
      .where('presentation_id', '=', presId)
      .where('anonymized_at', 'is', null);

    // Filter by slide if provided
    if (opts.slideId) {
      query = query.where('slide_id', '=', opts.slideId);
    }

    // Count total
    const countQuery = query
      .clearSelect()
      .select((eb) => eb.fn.count('id').as('count'));
    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.count) || 0;

    // Apply pagination
    const limit = Math.min(opts?.limit || 50, 100);
    const offset = opts?.offset || 0;

    query = query
      .orderBy('submitted_at', 'desc')
      .limit(limit)
      .offset(offset);

    const rows = await query.execute();

    return {
      leads: rows.map(rowToLead),
      total,
      limit,
      offset,
    };
  });
}

/**
 * Get lead count for a presentation.
 * @param {string} presentationId - The presentation ID
 * @returns {Promise<number>}
 */
export async function getLeadCountForPresentation(presentationId) {
  const presId = norm(presentationId);
  if (!presId) return 0;

  return withDbGuard(0, async (db) => {
    const result = await db
      .selectFrom('lead_submissions')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('presentation_id', '=', presId)
      .where('anonymized_at', 'is', null)
      .executeTakeFirst();

    return Number(result?.count) || 0;
  });
}

/**
 * Get leads by email for GDPR self-service.
 * @param {string} email - The email address
 * @returns {Promise<Object[]>}
 */
export async function getLeadsByEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return [];

  return withDbGuard([], async (db) => {
    const rows = await db
      .selectFrom('lead_submissions')
      .selectAll()
      .where('email', '=', e)
      .where('anonymized_at', 'is', null)
      .orderBy('submitted_at', 'desc')
      .execute();

    return rows.map(rowToLead);
  });
}

// ============================================================
// EXPORT
// ============================================================

/**
 * Export leads for a presentation as CSV data.
 * @param {string} presentationId - The presentation ID
 * @param {Object} opts - Options
 * @param {string} [opts.slideId] - Filter by slide ID
 * @returns {Promise<{csv: string, count: number}>}
 */
export async function exportLeadsAsCSV(presentationId, opts = {}) {
  const presId = norm(presentationId);
  if (!presId) return { csv: '', count: 0 };

  return withDbGuard({ csv: '', count: 0 }, async (db) => {
    let query = db
      .selectFrom('lead_submissions')
      .select([
        'name',
        'email',
        'slide_id',
        'submitted_at',
        'consent_text',
        'privacy_url',
      ])
      .where('presentation_id', '=', presId)
      .where('anonymized_at', 'is', null)
      .orderBy('submitted_at', 'desc');

    if (opts.slideId) {
      query = query.where('slide_id', '=', opts.slideId);
    }

    const rows = await query.execute();

    if (rows.length === 0) {
      return { csv: 'Name,Email,Slide ID,Submitted At,Consent Text,Privacy URL\n', count: 0 };
    }

    // Build CSV
    const headers = ['Name', 'Email', 'Slide ID', 'Submitted At', 'Consent Text', 'Privacy URL'];
    const csvRows = [headers.join(',')];

    for (const row of rows) {
      const values = [
        escapeCSV(row.name),
        escapeCSV(row.email),
        escapeCSV(row.slide_id),
        escapeCSV(row.submitted_at),
        escapeCSV(row.consent_text),
        escapeCSV(row.privacy_url || ''),
      ];
      csvRows.push(values.join(','));
    }

    return {
      csv: csvRows.join('\n'),
      count: rows.length,
    };
  });
}

// ============================================================
// DELETE / ANONYMIZE
// ============================================================

/**
 * Anonymize a lead (GDPR-compliant soft delete).
 * Sets name and email to '[deleted]' and marks anonymized_at.
 * @param {string} leadId - The lead ID
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function anonymizeLead(leadId) {
  const id = norm(leadId);
  if (!id) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const now = nowIso();

    const result = await db
      .updateTable('lead_submissions')
      .set({
        name: '[deleted]',
        email: '[deleted]',
        ip_address: null,
        user_agent: null,
        anonymized_at: now,
      })
      .where('id', '=', id)
      .where('anonymized_at', 'is', null)
      .executeTakeFirst();

    if (Number(result.numUpdatedRows) === 0) {
      return { ok: false, reason: 'not_found' };
    }

    return { ok: true };
  });
}

/**
 * Anonymize all leads for an email address (GDPR self-service delete).
 * @param {string} email - The email address
 * @returns {Promise<{ok: boolean, anonymized: number}>}
 */
export async function anonymizeLeadsByEmail(email) {
  const e = String(email || '').toLowerCase().trim();
  if (!e) return { ok: false, anonymized: 0 };

  return withDbGuard({ ok: false, anonymized: 0 }, async (db) => {
    const now = nowIso();

    const result = await db
      .updateTable('lead_submissions')
      .set({
        name: '[deleted]',
        email: '[deleted]',
        ip_address: null,
        user_agent: null,
        anonymized_at: now,
      })
      .where('email', '=', e)
      .where('anonymized_at', 'is', null)
      .executeTakeFirst();

    return {
      ok: true,
      anonymized: Number(result.numUpdatedRows) || 0,
    };
  });
}

/**
 * Anonymize leads where retention period has expired.
 * Called by the analytics cleanup job.
 * @returns {Promise<{anonymized: number}>}
 */
export async function anonymizeExpiredLeads() {
  return withDbGuard({ anonymized: 0 }, async (db) => {
    const now = nowIso();

    const result = await db
      .updateTable('lead_submissions')
      .set({
        name: '[deleted]',
        email: '[deleted]',
        ip_address: null,
        user_agent: null,
        anonymized_at: now,
      })
      .where('retention_expires_at', '<', now)
      .where('anonymized_at', 'is', null)
      .executeTakeFirst();

    return {
      anonymized: Number(result.numUpdatedRows) || 0,
    };
  });
}

/**
 * Anonymize IP addresses for leads older than specified date.
 * @param {string} olderThan - ISO date string
 * @returns {Promise<{anonymized: number}>}
 */
export async function anonymizeOldLeadIpAddresses(olderThan) {
  return withDbGuard({ anonymized: 0 }, async (db) => {
    const result = await db
      .updateTable('lead_submissions')
      .set({
        ip_address: null,
      })
      .where('submitted_at', '<', olderThan)
      .where('ip_address', 'is not', null)
      .where('anonymized_at', 'is', null)
      .executeTakeFirst();

    return {
      anonymized: Number(result.numUpdatedRows) || 0,
    };
  });
}

// ============================================================
// HELPERS
// ============================================================

/**
 * Convert database row to lead object.
 * @param {Object} row - Database row
 * @returns {Object} Lead object
 */
function rowToLead(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    presentationId: row.presentation_id,
    slideId: row.slide_id,
    name: row.name,
    email: row.email,
    consentGiven: row.consent_given,
    consentText: row.consent_text,
    privacyUrl: row.privacy_url,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    submittedAt: row.submitted_at,
    retentionExpiresAt: row.retention_expires_at,
    anonymizedAt: row.anonymized_at,
    createdAt: row.created_at,
  };
}

/**
 * Escape a value for CSV output.
 * @param {string} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeCSV(value) {
  const str = String(value ?? '');
  // If the value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
