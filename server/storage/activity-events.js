/**
 * Activity events storage for tracking organization activity.
 * Powers the activity feed. (Live comment notifications go through
 * services/comment-notifications.js — email + in-app + SSE — not through here.)
 */

import { crossOrganizationScope, toStorageContext } from './scope.js';

import { getOrgId } from '../utils/context.js';
import { norm, nowIso } from '../utils/normalize.js';
import { normalizeEmail } from '../../shared/email.js';
import { withDbGuard } from '../db/client.js';
import { keysetPage, keysetRows } from './keyset.js';
import { deckReadableExpression } from './presentations/index.js';
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
  // An API key's permission list was changed in place (B813). Carries no
  // presentation, so the feed shows it to the key owner's organization.
  API_KEY_PERMISSIONS_CHANGED: 'api_key.permissions_changed',
};

export const ENTITY_TYPES = {
  PRESENTATION: 'presentation',
  COMMENT: 'comment',
  SHARE_LINK: 'share_link',
  COLLABORATOR: 'collaborator',
  API_KEY: 'api_key',
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
  const actorEmail = normalizeEmail(data?.actorEmail);

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
 * The activity events a reader may see, newest first, as one keyset page or
 * (without `limit`) the whole list (B823, D358).
 *
 * Who sees what is decided in the query: an event on a deck is listed only
 * when the reader may open that deck by id (`deckReadableExpression` in
 * ./presentations/deck-list.js), an event on no deck is listed for every
 * reader of the organization. Filtering after the `LIMIT` would make a page
 * shorter than asked while there is more, which is what the feed did before.
 * The order is `(created_at desc, id desc)`.
 *
 * @param {import('./scope.js').StorageScope} scope - The caller's storage scope
 * @param {Object} filter
 * @param {{userId?: string|null, email?: string, unrestricted?: boolean}} filter.reader
 *   The reader's identity (`actorIdentity()`), its `userId` already resolved.
 *   Required: there is no list of events without a reader.
 * @param {string} [filter.presentationId] - Only events on this deck.
 * @param {string} [filter.eventType] - Only this event type.
 * @param {string[]} [filter.eventTypes] - Only these event types.
 * @param {string} [filter.excludeActorEmail] - Leave out this actor's events.
 * @param {string} [filter.since] - ISO time; events from then on.
 * @param {string} [filter.until] - ISO time or date; events up to then (a
 *   date includes the whole day).
 * @param {Object} [page]
 * @param {number} [page.limit] - Rows per page; the whole list when absent.
 * @param {{value: string, id: string}|null} [page.after] - Position of the
 *   last row seen.
 * @returns {Promise<{items: Object[], next: {value: string, id: string}|null}>}
 */
export async function listActivityEvents(
  scope,
  filter = {},
  { limit, after = null } = {},
) {
  toStorageContext(scope, 'listActivityEvents');
  const { reader } = filter;
  if (!reader || typeof reader !== 'object') {
    throw new TypeError('listActivityEvents() requires a reader');
  }
  return withDbGuard({ items: [], next: null }, async (db) => {
    const orgId = getOrgId(scope);

    let query = db
      .selectFrom('activity_events')
      .selectAll()
      .where('organization_id', '=', orgId)
      .where((eb) => {
        const onNoDeck = eb('activity_events.presentation_id', 'is', null);
        const readable = deckReadableExpression(scope, eb, {
          reader,
          deckRef: 'activity_events.presentation_id',
        });
        return readable ? eb.or([onNoDeck, readable]) : onNoDeck;
      });

    if (filter.presentationId) {
      query = query.where('presentation_id', '=', filter.presentationId);
    }
    if (filter.eventType) {
      query = query.where('event_type', '=', filter.eventType);
    }
    if (Array.isArray(filter.eventTypes) && filter.eventTypes.length > 0) {
      query = query.where('event_type', 'in', filter.eventTypes);
    }

    // Exclude events by actor (for "others' activity"). There is no positive
    // actor filter: the route that offered one keyed it on an address no
    // response carries any more (D22) and no client ever sent it.
    // `excludeActorEmail` is different — the caller passes their *own* address,
    // which they plainly have.
    if (filter.excludeActorEmail) {
      query = query.where(
        'actor_email',
        '!=',
        normalizeEmail(filter.excludeActorEmail),
      );
    }

    if (filter.since) {
      query = query.where('created_at', '>=', filter.since);
    }
    if (filter.until) {
      // A date-only value (YYYY-MM-DD) includes the entire day.
      const untilValue = /^\d{4}-\d{2}-\d{2}$/.test(filter.until)
        ? `${filter.until}T23:59:59.999Z`
        : filter.until;
      query = query.where('created_at', '<=', untilValue);
    }

    let rows;
    let next = null;
    if (limit === undefined) {
      rows = await query
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .execute();
    } else {
      ({ rows, next } = keysetRows(
        await keysetPage(query, {
          column: 'created_at',
          after,
          limit,
        }).execute(),
        limit,
      ));
    }
    const lookup = await actorDisplayNames(rows);
    return { items: rows.map((row) => rowToEvent(row, lookup)), next };
  });
}

/**
 * Delete old activity events (cleanup job).
 *
 * Instance-wide: a scheduled retention job has no organization context, so this
 * deletes across every organization, the same model as the analytics cleanup.
 * Only an instance retention scope is accepted (storage-scope.md category 7).
 * @param {import('./scope.js').StorageScope} scope - Reasoned instance retention scope
 * @param {string} olderThan - ISO timestamp; events created before it are removed
 * @returns {Promise<{deleted: number}>}
 */
export async function deleteOldActivityEvents(scope, olderThan) {
  const context = toStorageContext(
    scope,
    'deleteOldActivityEvents',
    {},
    { allowCrossOrganization: true },
  );
  if (context.organizationId || !context.crossOrganization)
    throw new TypeError(
      'deleteOldActivityEvents() requires an instance retention scope',
    );
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
  const email = normalizeEmail(userEmail);
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
  const email = normalizeEmail(userEmail);
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
  const email = normalizeEmail(userEmail);
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
  return resolveDisplayNames(
    crossOrganizationScope(
      null,
      'global identity display and stable user identifier lookup',
    ),
    stamps,
  );
}
