/**
 * Activity events storage for tracking organization activity.
 * Powers the activity feed. (Live comment notifications go through
 * services/comment-notifications.js — email + in-app + SSE — not through here.)
 */

import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';
import { norm, nowIso } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';
import {
  resolveDisplayNames,
  toStoredActorIdentity,
  NO_DISPLAY_NAMES,
} from './display-identity.js';

// ============================================================
// EVENT TYPES
// ============================================================

export const EVENT_TYPES = {
  PRESENTATION_CREATED: 'presentation.created',
  PRESENTATION_UPDATED: 'presentation.updated',
  PRESENTATION_MERGED: 'presentation.merged',
  PRESENTATION_DELETED: 'presentation.deleted',
  PRESENTATION_MOVED_TO_ORGANIZATION: 'presentation.moved_to_organization',
  OWNERSHIP_TRANSFERRED: 'presentation.ownership_transferred',
  COLLABORATOR_ADDED: 'collaborator.added',
  COLLABORATOR_REMOVED: 'collaborator.removed',
  COLLABORATOR_PERMISSION_CHANGED: 'collaborator.permission_changed',
  COMMENT_CREATED: 'comment.created',
  COMMENT_RESOLVED: 'comment.resolved',
  COMMENT_REOPENED: 'comment.reopened',
  // Historical-only: no emitter records this anymore, but the activity feed
  // still renders stored 'share.accessed' events (client overview-activity.js),
  // so the type and its SHARE_LINK entity below stay as a rendering contract.
  SHARE_ACCESSED: 'share.accessed',
  SLIDE_ADDED: 'slide.added',
};

export const ENTITY_TYPES = {
  PRESENTATION: 'presentation',
  COMMENT: 'comment',
  SHARE_LINK: 'share_link',
  COLLABORATOR: 'collaborator',
};

export const ACTOR_TYPES = {
  USER: 'user',
  GUEST: 'guest',
  SYSTEM: 'system',
};

// ============================================================
// ACTIVITY EVENTS CRUD
// ============================================================

/**
 * Create a new activity event.
 */
export async function createActivityEvent(scope, data) {
  toStorageContext(scope, 'createActivityEvent');
  const eventType = norm(data?.eventType);
  const entityType = norm(data?.entityType);
  const entityId = norm(data?.entityId);
  const actorEmail = norm(data?.actorEmail)?.toLowerCase();

  if (!eventType || !entityType || !entityId || !actorEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    const row = await db
      .insertInto('activity_events')
      .values({
        organization_id: orgId,
        event_type: eventType,
        entity_type: entityType,
        entity_id: entityId,
        presentation_id: data?.presentationId || null,
        actor_email: actorEmail,
        actor_name: data?.actorName || actorEmail,
        actor_type: data?.actorType || ACTOR_TYPES.USER,
        data: data?.data || {},
        created_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      event: rowToEvent(row, await actorDisplayNames([row])),
    };
  });
}

/**
 * List activity events for an organization.
 * Supports pagination and filtering.
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} [opts] - Pagination and filter options
 */
export async function listActivityEvents(scope, opts = {}) {
  return withDbGuard({ events: [], total: 0 }, async (db) => {
    const orgId = getOrgId(scope);

    let query = db
      .selectFrom('activity_events')
      .selectAll()
      .where('organization_id', '=', orgId);

    // Filter by presentation
    if (opts?.presentationId) {
      query = query.where('presentation_id', '=', opts.presentationId);
    }

    // Filter by event type
    if (opts?.eventType) {
      query = query.where('event_type', '=', opts.eventType);
    }

    // Filter by event types (array)
    if (Array.isArray(opts?.eventTypes) && opts.eventTypes.length > 0) {
      query = query.where('event_type', 'in', opts.eventTypes);
    }

    // Filter by actor
    if (opts?.actorEmail) {
      query = query.where('actor_email', '=', opts.actorEmail.toLowerCase());
    }

    // Exclude events by actor (for "others' activity")
    if (opts?.excludeActorEmail) {
      query = query.where(
        'actor_email',
        '!=',
        opts.excludeActorEmail.toLowerCase(),
      );
    }

    // Filter by date range
    if (opts?.since) {
      query = query.where('created_at', '>=', opts.since);
    }

    if (opts?.until) {
      // If until is a date-only string (YYYY-MM-DD), include the entire day
      let untilValue = opts.until;
      if (/^\d{4}-\d{2}-\d{2}$/.test(opts.until)) {
        untilValue = `${opts.until}T23:59:59.999Z`;
      }
      query = query.where('created_at', '<=', untilValue);
    }

    // Count total before pagination
    const countQuery = query
      .clearSelect()
      .select((eb) => eb.fn.count('id').as('count'));
    const countResult = await countQuery.executeTakeFirst();
    const total = Number(countResult?.count) || 0;

    // Apply pagination
    const limit = Math.min(opts?.limit || 50, 100);
    const offset = opts?.offset || 0;

    query = query.orderBy('created_at', 'desc').limit(limit).offset(offset);

    const rows = await query.execute();
    const lookup = await actorDisplayNames(rows);

    return {
      events: rows.map((row) => rowToEvent(row, lookup)),
      total,
      limit,
      offset,
    };
  });
}

/**
 * Delete old activity events (cleanup job).
 *
 * Instance-wide: a scheduled retention job has no organization context, so this
 * deletes across every organization, the same model as the analytics cleanup.
 * @param {string} olderThan - ISO timestamp; events created before it are removed
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteOldActivityEvents(olderThan) {
  return withDbGuard({ deleted: 0 }, async (db) => {
    const result = await db
      .deleteFrom('activity_events')
      .where('created_at', '<', olderThan)
      .executeTakeFirst();

    return { deleted: Number(result.numDeletedRows) || 0 };
  });
}

// ============================================================
// USER EVENT READS (for "seen" tracking)
// ============================================================

/**
 * Get the user's last read position.
 */
async function getUserEventRead(userEmail, scope) {
  const email = norm(userEmail)?.toLowerCase();
  if (!email) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(scope);

    const row = await db
      .selectFrom('user_event_reads')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where('user_email', '=', email)
      .executeTakeFirst();

    if (!row) return null;
    return {
      id: row.id,
      userEmail: row.user_email,
      lastReadEventId: row.last_read_event_id,
      lastReadAt: row.last_read_at,
    };
  });
}

/**
 * Update user's last read position.
 */
export async function updateUserEventRead(scope, userEmail, eventId) {
  toStorageContext(scope, 'updateUserEventRead');
  const email = norm(userEmail)?.toLowerCase();
  if (!email) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(scope);
    const now = nowIso();

    // Upsert the read marker
    await db
      .insertInto('user_event_reads')
      .values({
        organization_id: orgId,
        user_email: email,
        last_read_event_id: eventId || null,
        last_read_at: now,
      })
      .onConflict((oc) =>
        oc.columns(['organization_id', 'user_email']).doUpdateSet({
          last_read_event_id: eventId || null,
          last_read_at: now,
        }),
      )
      .execute();

    return { ok: true };
  });
}

/**
 * Get unread event counts grouped by presentation, so callers can apply
 * per-presentation access filtering before summing — the raw total would
 * leak activity on decks the user cannot read.
 * @returns {Promise<Array<{presentationId: string|null, count: number}>>}
 */
export async function getUnreadEventCountsByPresentation(scope, userEmail) {
  toStorageContext(scope, 'getUnreadEventCountsByPresentation');
  const email = norm(userEmail)?.toLowerCase();
  if (!email) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(scope);

    const readMarker = await getUserEventRead(email, scope);

    let query = db
      .selectFrom('activity_events')
      .select('presentation_id')
      .select((eb) => eb.fn.count('id').as('count'))
      .where('organization_id', '=', orgId)
      .where('actor_email', '!=', email) // Exclude own events
      .groupBy('presentation_id');

    if (readMarker?.lastReadAt) {
      query = query.where('created_at', '>', readMarker.lastReadAt);
    }

    const rows = await query.execute();
    return rows.map((row) => ({
      presentationId: row.presentation_id || null,
      count: Number(row.count) || 0,
    }));
  });
}

// ============================================================
// HELPERS
// ============================================================

function rowToEvent(row, lookup = NO_DISPLAY_NAMES) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    presentationId: row.presentation_id,
    // Who acted is display, never a decision (D22). `actorName` was written
    // as `actor?.name || actor?.email`, so the address leaked through both
    // fields and the client stripped the `@` back off it for rendering; the
    // pair does that once, behind the boundary. See
    // server/storage/display-identity.js.
    actor: toStoredActorIdentity(row.actor_email, row.actor_name, lookup),
    actorType: row.actor_type,
    data: row.data || {},
    createdAt: row.created_at,
  };
}

/**
 * Resolve the display names a batch of activity rows needs.
 *
 * `activity_events` stores no actor id (see storage/display-identity.js on why
 * a display stamp gets no id column), so the address is the lookup key and the
 * resolved identity's `id` stays null.
 *
 * @param {Array<Object>} rows - Raw `activity_events` rows.
 * @returns {Promise<import('./display-identity.js').DisplayNameLookup>}
 */
async function actorDisplayNames(rows) {
  const stamps = (rows || [])
    .filter((row) => row?.actor_email)
    .map((row) => ({ email: row.actor_email }));
  if (!stamps.length) return NO_DISPLAY_NAMES;
  return resolveDisplayNames(stamps);
}
