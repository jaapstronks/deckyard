/**
 * Guest verification and management for share links.
 */

import { getOrgId } from '../../utils/context.js';
import { norm, nowIso, isoAfter, isoBefore, normalizeEmail } from '../../utils/normalize.js';
import { withDbGuard } from '../utils/db-guard.js';
import { generateGuestToken } from './index.js';
import { formatShareLink, getValidShareLinkById } from './crud.js';

/**
 * Format a database row into a guest object.
 * @param {Object} row - Database row
 * @returns {Object} - Formatted guest
 */
export function formatGuest(row) {
  return {
    id: row.id,
    shareLinkId: row.share_link_id,
    email: row.email,
    name: row.name,
    verifiedAt: row.verified_at,
    sessionExpiresAt: row.session_expires_at,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
    invitedAt: row.invited_at,
    invitedBy: row.invited_by,
    invitationSentAt: row.invitation_sent_at,
  };
}

/**
 * Request guest verification for a share link.
 * Creates or updates a guest record and returns a verification token.
 * Rate limited to 3 requests per email per hour.
 * @param {string} shareLinkId - The share link ID
 * @param {string} email - Guest email address
 * @param {string} [name] - Guest name (optional)
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with verification token
 */
export async function requestGuestVerification(shareLinkId, email, name, ctx) {
  const id = norm(shareLinkId);
  if (!id) {
    return { ok: false, reason: 'invalid' };
  }

  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Validate the share link
    const validation = await getValidShareLinkById(db, id, orgId);
    if (!validation.ok) {
      return validation;
    }
    const { shareLink } = validation;

    if (!['comment', 'edit'].includes(shareLink.permission)) {
      return { ok: false, reason: 'permission_denied' };
    }

    // Check registration mode - if invite_only, guest must be pre-registered
    if (shareLink.registration_mode === 'invite_only') {
      const existingGuest = await db
        .selectFrom('share_link_guests')
        .selectAll()
        .where('share_link_id', '=', id)
        .where('email', '=', normalized)
        .executeTakeFirst();

      // If guest doesn't exist and wasn't pre-invited, reject
      if (!existingGuest || !existingGuest.invited_at) {
        return { ok: false, reason: 'not_invited' };
      }
    }

    // Rate limiting: max 3 verification requests per email per hour
    const oneHourAgo = isoBefore(60 * 60 * 1000);
    const recentRequests = await db
      .selectFrom('share_link_guests')
      .select(db.fn.count('id').as('count'))
      .where('email', '=', normalized)
      .where('created_at', '>=', oneHourAgo)
      .executeTakeFirst();

    if (recentRequests && Number(recentRequests.count) >= 3) {
      return { ok: false, reason: 'rate_limited' };
    }

    // Generate verification token
    const verificationToken = generateGuestToken();
    const verificationExpires = isoAfter(24 * 60 * 60 * 1000); // 24 hours

    // Check if guest already exists for this share link + email
    const existingGuest = await db
      .selectFrom('share_link_guests')
      .selectAll()
      .where('share_link_id', '=', id)
      .where('email', '=', normalized)
      .executeTakeFirst();

    let guestId;

    if (existingGuest) {
      // Update existing guest with new verification token
      const updated = await db
        .updateTable('share_link_guests')
        .set({
          name: name || existingGuest.name,
          verification_token: verificationToken,
          verification_token_expires_at: verificationExpires,
        })
        .where('id', '=', existingGuest.id)
        .returningAll()
        .executeTakeFirst();
      guestId = updated.id;
    } else {
      // Create new guest record
      const inserted = await db
        .insertInto('share_link_guests')
        .values({
          organization_id: orgId,
          share_link_id: id,
          email: normalized,
          name: name || null,
          verification_token: verificationToken,
          verification_token_expires_at: verificationExpires,
        })
        .returningAll()
        .executeTakeFirst();
      guestId = inserted.id;
    }

    return {
      ok: true,
      guestId,
      verificationToken,
      expiresAt: verificationExpires,
    };
  });
}

/**
 * Verify a guest's email and create a session.
 * @param {string} verificationToken - The verification token
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with session token and guest info
 */
export async function verifyGuestEmail(verificationToken, ctx) {
  const token = norm(verificationToken);
  if (!token) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    // Find guest by verification token
    const guest = await db
      .selectFrom('share_link_guests')
      .selectAll()
      .where('verification_token', '=', token)
      .executeTakeFirst();

    if (!guest) {
      return { ok: false, reason: 'invalid_token' };
    }

    // Check token expiration
    if (guest.verification_token_expires_at &&
        new Date(guest.verification_token_expires_at) < new Date()) {
      return { ok: false, reason: 'token_expired' };
    }

    // Verify the share link is still valid (use org from guest's share link)
    const shareLinkRow = await db
      .selectFrom('presentation_share_links')
      .select(['organization_id'])
      .where('id', '=', guest.share_link_id)
      .executeTakeFirst();

    if (!shareLinkRow) {
      return { ok: false, reason: 'share_link_revoked' };
    }

    const validation = await getValidShareLinkById(db, guest.share_link_id, shareLinkRow.organization_id);
    if (!validation.ok) {
      return { ok: false, reason: validation.reason === 'share_link_not_found' ? 'share_link_revoked' : validation.reason };
    }
    const { shareLink } = validation;

    // Generate session token
    const sessionToken = generateGuestToken();
    const now = nowIso();
    const sessionExpires = isoAfter(7 * 24 * 60 * 60 * 1000); // 7 days

    // Update guest with verified status and session token
    const updated = await db
      .updateTable('share_link_guests')
      .set({
        verification_token: null,
        verification_token_expires_at: null,
        verified_at: now,
        session_token: sessionToken,
        session_expires_at: sessionExpires,
        last_accessed_at: now,
      })
      .where('id', '=', guest.id)
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      guest: formatGuest(updated),
      shareLink: formatShareLink(shareLink),
      sessionToken,
      sessionExpiresAt: sessionExpires,
    };
  });
}

/**
 * Get a guest by their session token.
 * Also validates that the associated share link is still valid.
 * Only refreshes session if not expired.
 * @param {string} sessionToken - The session token
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - Guest info or null
 */
export async function getGuestBySessionToken(sessionToken, ctx) {
  const token = norm(sessionToken);
  if (!token) return null;

  return withDbGuard(null, async (db) => {
    const now = nowIso();

    // Find guest by session token
    const guest = await db
      .selectFrom('share_link_guests')
      .selectAll()
      .where('session_token', '=', token)
      .executeTakeFirst();

    if (!guest) return null;

    // Check session expiration
    if (guest.session_expires_at &&
        new Date(guest.session_expires_at) < new Date()) {
      return null;
    }

    // Check if verified
    if (!guest.verified_at) return null;

    // Verify the share link is still valid
    const validation = await getValidShareLinkById(db, guest.share_link_id, guest.organization_id);
    if (!validation.ok) return null;
    const { shareLink } = validation;

    // Update last accessed time only for non-expired sessions
    await db
      .updateTable('share_link_guests')
      .set({ last_accessed_at: now })
      .where('session_token', '=', token)
      .where('session_expires_at', '>', now)
      .execute();

    return {
      guest: formatGuest(guest),
      shareLink: formatShareLink(shareLink),
    };
  });
}

/**
 * Get a guest by share link and email.
 * @param {string} shareLinkId - The share link ID
 * @param {string} email - The guest email
 * @param {Object} ctx - Context object
 * @returns {Promise<Object|null>} - Guest info or null
 */
export async function getGuestByEmail(shareLinkId, email, ctx) {
  const id = norm(shareLinkId);
  const normalized = normalizeEmail(email);
  if (!id || !normalized) return null;

  return withDbGuard(null, async (db) => {
    const guest = await db
      .selectFrom('share_link_guests')
      .selectAll()
      .where('share_link_id', '=', id)
      .where('email', '=', normalized)
      .executeTakeFirst();

    return guest ? formatGuest(guest) : null;
  });
}

/**
 * Extend a guest's session (called on each access).
 * @param {string} guestId - The guest ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Updated session info
 */
export async function extendGuestSession(guestId, ctx) {
  const id = norm(guestId);
  if (!id) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const sessionExpires = isoAfter(7 * 24 * 60 * 60 * 1000); // 7 days

    const updated = await db
      .updateTable('share_link_guests')
      .set({
        session_expires_at: sessionExpires,
        last_accessed_at: nowIso(),
      })
      .where('id', '=', id)
      .where('verified_at', 'is not', null)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      sessionExpiresAt: sessionExpires,
    };
  });
}

/**
 * Invalidate all guest sessions for a share link.
 * Called when a share link is revoked.
 * @param {string} shareLinkId - The share link ID
 * @param {Object} ctx - Context object
 * @returns {Promise<number>} - Number of sessions invalidated
 */
export async function invalidateGuestSessions(shareLinkId, ctx) {
  const id = norm(shareLinkId);
  if (!id) return 0;

  return withDbGuard(0, async (db) => {
    const result = await db
      .updateTable('share_link_guests')
      .set({
        session_token: null,
        session_expires_at: null,
      })
      .where('share_link_id', '=', id)
      .where('session_token', 'is not', null)
      .executeTakeFirst();

    return Number(result.numUpdatedRows) || 0;
  });
}

/**
 * Pre-register a guest for a share link (invite-only mode).
 * @param {string} shareLinkId - The share link ID
 * @param {Object} guestData - Guest data
 * @param {string} guestData.email - Guest email
 * @param {string} [guestData.name] - Guest name
 * @param {string} invitedBy - Email of the inviter
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result with guest info
 */
export async function preRegisterGuest(shareLinkId, guestData, invitedBy, ctx) {
  const id = norm(shareLinkId);
  if (!id) {
    return { ok: false, reason: 'invalid' };
  }

  const normalized = normalizeEmail(guestData?.email);
  if (!normalized || !normalized.includes('@')) {
    return { ok: false, reason: 'invalid_email' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    // Verify share link exists and belongs to this org
    const validation = await getValidShareLinkById(db, id, orgId);
    if (!validation.ok) {
      return validation;
    }

    // Check if guest already exists
    const existing = await db
      .selectFrom('share_link_guests')
      .selectAll()
      .where('share_link_id', '=', id)
      .where('email', '=', normalized)
      .executeTakeFirst();

    const now = nowIso();

    if (existing) {
      // Update existing guest with invitation info if not already invited
      if (existing.invited_at) {
        return { ok: false, reason: 'already_invited' };
      }

      const updated = await db
        .updateTable('share_link_guests')
        .set({
          name: guestData.name || existing.name,
          invited_at: now,
          invited_by: invitedBy || null,
        })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirst();

      return {
        ok: true,
        guest: formatGuest(updated),
        isNew: false,
      };
    }

    // Create new guest with invitation
    const inserted = await db
      .insertInto('share_link_guests')
      .values({
        organization_id: orgId,
        share_link_id: id,
        email: normalized,
        name: guestData.name || null,
        invited_at: now,
        invited_by: invitedBy || null,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      guest: formatGuest(inserted),
      isNew: true,
    };
  });
}

/**
 * List all guests for a share link.
 * @param {string} shareLinkId - The share link ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Array>} - List of guests
 */
export async function listGuestsForShareLink(shareLinkId, ctx) {
  const id = norm(shareLinkId);
  if (!id) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const rows = await db
      .selectFrom('share_link_guests')
      .selectAll()
      .where('share_link_id', '=', id)
      .where('organization_id', '=', orgId)
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(formatGuest);
  });
}

/**
 * Remove a guest from a share link.
 * @param {string} guestId - The guest ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function removeGuest(guestId, ctx) {
  const id = norm(guestId);
  if (!id) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('share_link_guests')
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    return {
      ok: true,
      deleted: result.numDeletedRows > 0,
    };
  });
}

/**
 * Update invitation sent timestamp for a guest.
 * @param {string} guestId - The guest ID
 * @param {Object} ctx - Context object
 * @returns {Promise<Object>} - Result
 */
export async function markInvitationSent(guestId, ctx) {
  const id = norm(guestId);
  if (!id) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);

    const updated = await db
      .updateTable('share_link_guests')
      .set({
        invitation_sent_at: nowIso(),
      })
      .where('id', '=', id)
      .where('organization_id', '=', orgId)
      .returningAll()
      .executeTakeFirst();

    if (!updated) {
      return { ok: false, reason: 'not_found' };
    }

    return {
      ok: true,
      guest: formatGuest(updated),
    };
  });
}