/**
 * Activity events storage for tracking workspace activity.
 * Powers the activity feed and notification system.
 */

import { getOrgId } from '../utils/context.js';
import { norm, nowIso } from '../utils/normalize.js';
import { withDbGuard } from './utils/db-guard.js';

// ============================================================
// EVENT TYPES
// ============================================================

export const EVENT_TYPES = {
  PRESENTATION_CREATED: 'presentation.created',
  PRESENTATION_UPDATED: 'presentation.updated',
  PRESENTATION_MERGED: 'presentation.merged',
  PRESENTATION_DELETED: 'presentation.deleted',
  PRESENTATION_MOVED_TO_WORKSPACE: 'presentation.moved_to_workspace',
  OWNERSHIP_TRANSFERRED: 'presentation.ownership_transferred',
  COLLABORATOR_ADDED: 'collaborator.added',
  COMMENT_CREATED: 'comment.created',
  COMMENT_RESOLVED: 'comment.resolved',
  COMMENT_REOPENED: 'comment.reopened',
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
export async function createActivityEvent(data, ctx) {
  const eventType = norm(data?.eventType);
  const entityType = norm(data?.entityType);
  const entityId = norm(data?.entityId);
  const actorEmail = norm(data?.actorEmail)?.toLowerCase();

  if (!eventType || !entityType || !entityId || !actorEmail) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
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
      event: rowToEvent(row),
    };
  });
}

/**
 * List activity events for an organization.
 * Supports pagination and filtering.
 */
export async function listActivityEvents(ctx, opts = {}) {
  return withDbGuard({ events: [], total: 0 }, async (db) => {
    const orgId = getOrgId(ctx);

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
      query = query.where('actor_email', '!=', opts.excludeActorEmail.toLowerCase());
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

    query = query
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    const rows = await query.execute();

    return {
      events: rows.map(rowToEvent),
      total,
      limit,
      offset,
    };
  });
}

/**
 * Get a single activity event by ID.
 */
export async function getActivityEvent(eventId, ctx) {
  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

    const row = await db
      .selectFrom('activity_events')
      .selectAll()
      .where('id', '=', eventId)
      .where('organization_id', '=', orgId)
      .executeTakeFirst();

    if (!row) return null;
    return rowToEvent(row);
  });
}

/**
 * Delete old activity events (cleanup job).
 */
export async function deleteOldActivityEvents(olderThan, ctx) {
  return withDbGuard({ deleted: 0 }, async (db) => {
    const orgId = getOrgId(ctx);

    const result = await db
      .deleteFrom('activity_events')
      .where('organization_id', '=', orgId)
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
export async function getUserEventRead(userEmail, ctx) {
  const email = norm(userEmail)?.toLowerCase();
  if (!email) return null;

  return withDbGuard(null, async (db) => {
    const orgId = getOrgId(ctx);

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
export async function updateUserEventRead(userEmail, eventId, ctx) {
  const email = norm(userEmail)?.toLowerCase();
  if (!email) return { ok: false, reason: 'invalid' };

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
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
        })
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
export async function getUnreadEventCountsByPresentation(userEmail, ctx) {
  const email = norm(userEmail)?.toLowerCase();
  if (!email) return [];

  return withDbGuard([], async (db) => {
    const orgId = getOrgId(ctx);

    const readMarker = await getUserEventRead(email, ctx);

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
// NOTIFICATION QUEUE
// ============================================================

/**
 * Add a notification to the queue.
 */
export async function queueNotification(data, ctx) {
  const recipientEmail = norm(data?.recipientEmail)?.toLowerCase();
  const eventId = norm(data?.eventId);
  const channel = norm(data?.channel);

  if (!recipientEmail || !eventId || !channel) {
    return { ok: false, reason: 'invalid' };
  }

  return withDbGuard({ ok: false, reason: 'unavailable' }, async (db) => {
    const orgId = getOrgId(ctx);
    const now = nowIso();

    const row = await db
      .insertInto('notification_queue')
      .values({
        organization_id: orgId,
        recipient_email: recipientEmail,
        event_id: eventId,
        channel: channel,
        status: 'pending',
        created_at: now,
      })
      .returningAll()
      .executeTakeFirst();

    return {
      ok: true,
      notification: {
        id: row.id,
        recipientEmail: row.recipient_email,
        eventId: row.event_id,
        channel: row.channel,
        status: row.status,
        createdAt: row.created_at,
      },
    };
  });
}

/**
 * Get pending notifications for processing.
 */
export async function getPendingNotifications(opts = {}) {
  return withDbGuard([], async (db) => {
    const limit = opts?.limit || 100;

    const rows = await db
      .selectFrom('notification_queue')
      .innerJoin('activity_events', 'activity_events.id', 'notification_queue.event_id')
      .select([
        'notification_queue.id',
        'notification_queue.recipient_email',
        'notification_queue.event_id',
        'notification_queue.channel',
        'notification_queue.organization_id',
        'notification_queue.created_at',
        'activity_events.event_type',
        'activity_events.entity_type',
        'activity_events.entity_id',
        'activity_events.presentation_id',
        'activity_events.actor_email',
        'activity_events.actor_name',
        'activity_events.data as event_data',
      ])
      .where('notification_queue.status', '=', 'pending')
      .orderBy('notification_queue.created_at', 'asc')
      .limit(limit)
      .execute();

    return rows.map((row) => ({
      id: row.id,
      recipientEmail: row.recipient_email,
      eventId: row.event_id,
      channel: row.channel,
      organizationId: row.organization_id,
      createdAt: row.created_at,
      event: {
        type: row.event_type,
        entityType: row.entity_type,
        entityId: row.entity_id,
        presentationId: row.presentation_id,
        actorEmail: row.actor_email,
        actorName: row.actor_name,
        data: row.event_data,
      },
    }));
  });
}

/**
 * Mark a notification as sent.
 */
export async function markNotificationSent(notificationId) {
  return withDbGuard({ ok: false }, async (db) => {
    const now = nowIso();

    await db
      .updateTable('notification_queue')
      .set({
        status: 'sent',
        processed_at: now,
      })
      .where('id', '=', notificationId)
      .execute();

    return { ok: true };
  });
}

/**
 * Suppress a notification (e.g., already seen in app).
 */
export async function suppressNotification(notificationId, reason) {
  return withDbGuard({ ok: false }, async (db) => {
    const now = nowIso();

    await db
      .updateTable('notification_queue')
      .set({
        status: 'suppressed',
        suppression_reason: reason || 'unknown',
        processed_at: now,
      })
      .where('id', '=', notificationId)
      .execute();

    return { ok: true };
  });
}

/**
 * Check if user has seen an event (for notification suppression).
 */
export async function hasUserSeenEvent(userEmail, eventCreatedAt, ctx) {
  const email = norm(userEmail)?.toLowerCase();
  if (!email) return false;

  const readMarker = await getUserEventRead(email, ctx);
  if (!readMarker?.lastReadAt) return false;

  return new Date(readMarker.lastReadAt) >= new Date(eventCreatedAt);
}

// ============================================================
// HELPERS
// ============================================================

function rowToEvent(row) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    eventType: row.event_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    presentationId: row.presentation_id,
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    actorType: row.actor_type,
    data: row.data || {},
    createdAt: row.created_at,
  };
}