/**
 * Activity events service - helper functions for recording events.
 * Use this module to emit events from route handlers.
 */

import {
  createActivityEvent,
  queueNotification,
  EVENT_TYPES,
  ENTITY_TYPES,
  ACTOR_TYPES,
} from '../storage/activity-events.js';
import { createRouteContext } from '../utils/context.js';

// Re-export constants for convenience
export { EVENT_TYPES, ENTITY_TYPES, ACTOR_TYPES };

/**
 * Record a presentation created event.
 */
export async function recordPresentationCreated({
  presentation,
  actor,
  ctx,
}) {
  const context = ctx || createRouteContext(actor);

  return createActivityEvent({
    eventType: EVENT_TYPES.PRESENTATION_CREATED,
    entityType: ENTITY_TYPES.PRESENTATION,
    entityId: presentation.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      title: presentation.title,
      scope: presentation.scope,
    },
  }, context);
}

/**
 * Record a presentation updated event.
 */
export async function recordPresentationUpdated({
  presentation,
  actor,
  changes,
  ctx,
}) {
  const context = ctx || createRouteContext(actor);

  return createActivityEvent({
    eventType: EVENT_TYPES.PRESENTATION_UPDATED,
    entityType: ENTITY_TYPES.PRESENTATION,
    entityId: presentation.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      title: presentation.title,
      changes: changes || {},
    },
  }, context);
}

/**
 * Record slides added to a deck during a save. Emitted for decks of any scope
 * (the feed enrichment filters by read access, so private/shared decks only
 * surface this to people who can already open them) — the whole point is
 * collaborators seeing "someone added slides to a deck I'm on". One bundled
 * event per save carries the count + ids, so adding N slides is one feed line,
 * not N. No-op when no slides were added.
 *
 * @param {object} args
 * @param {object} args.presentation - the updated presentation
 * @param {object} args.actor - the acting user ({ email, name })
 * @param {string[]} args.slideIds - ids of the newly added slides
 * @param {object} [args.ctx] - route context
 * @returns {Promise<object|null>}
 */
export async function recordSlidesAdded({ presentation, actor, slideIds, ctx }) {
  const ids = Array.isArray(slideIds) ? slideIds.filter(Boolean) : [];
  if (ids.length === 0) return null;

  const context = ctx || createRouteContext(actor);

  return createActivityEvent({
    eventType: EVENT_TYPES.SLIDE_ADDED,
    entityType: ENTITY_TYPES.PRESENTATION,
    entityId: presentation.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      title: presentation.title,
      count: ids.length,
      slideIds: ids,
    },
  }, context);
}

/**
 * Record a slide-level merge performed during a save. Audit trail for the
 * stale-tab overwrite class of incidents: without it a silent merge leaves
 * no trace of which slides were taken from whom.
 */
export async function recordSlideLevelMerge({
  presentation,
  actorEmail,
  merge,
  ctx,
}) {
  const context = ctx || createRouteContext({ email: actorEmail });

  return createActivityEvent({
    eventType: EVENT_TYPES.PRESENTATION_MERGED,
    entityType: ENTITY_TYPES.PRESENTATION,
    entityId: presentation.id,
    presentationId: presentation.id,
    actorEmail,
    actorName: actorEmail,
    actorType: ACTOR_TYPES.USER,
    data: {
      title: presentation.title,
      revisionGap: merge?.revisionGap ?? null,
      modifiedSlideIds: merge?.modifiedSlideIds || [],
      appendedSlideIds: merge?.appendedSlideIds || [],
      clientReordered: merge?.clientReordered ?? null,
      resultRevision: presentation.revision ?? null,
    },
  }, context);
}

/**
 * Record a presentation deleted event.
 */
export async function recordPresentationDeleted({
  presentation,
  actor,
  ctx,
}) {
  const context = ctx || createRouteContext(actor);

  return createActivityEvent({
    eventType: EVENT_TYPES.PRESENTATION_DELETED,
    entityType: ENTITY_TYPES.PRESENTATION,
    entityId: presentation.id,
    presentationId: null, // Can't reference deleted presentation
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      title: presentation.title,
    },
  }, context);
}

/**
 * Record a presentation moved to workspace event.
 */
export async function recordPresentationMovedToWorkspace({
  presentation,
  actor,
  previousScope,
  ctx,
}) {
  const context = ctx || createRouteContext(actor);

  return createActivityEvent({
    eventType: EVENT_TYPES.PRESENTATION_MOVED_TO_WORKSPACE,
    entityType: ENTITY_TYPES.PRESENTATION,
    entityId: presentation.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      title: presentation.title,
      previousScope,
      newScope: presentation.scope,
    },
  }, context);
}

/**
 * Record a comment created event.
 */
export async function recordCommentCreated({
  comment,
  presentation,
  actor,
  isGuest,
  ctx,
}) {
  const context = ctx || createRouteContext(actor);

  const result = await createActivityEvent({
    eventType: EVENT_TYPES.COMMENT_CREATED,
    entityType: ENTITY_TYPES.COMMENT,
    entityId: comment.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: isGuest ? ACTOR_TYPES.GUEST : ACTOR_TYPES.USER,
    data: {
      presentationTitle: presentation.title,
      slideId: comment.slideId,
      bodyPreview: comment.body?.substring(0, 100),
      isReply: !!comment.parentId,
    },
  }, context);

  return result;
}

/**
 * Record a comment resolved event.
 */
export async function recordCommentResolved({
  comment,
  presentation,
  actor,
  ctx,
}) {
  const context = ctx || createRouteContext(actor);

  return createActivityEvent({
    eventType: EVENT_TYPES.COMMENT_RESOLVED,
    entityType: ENTITY_TYPES.COMMENT,
    entityId: comment.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      presentationTitle: presentation.title,
      slideId: comment.slideId,
      commentAuthor: comment.authorEmail,
    },
  }, context);
}

/**
 * Record a comment reopened event.
 */
export async function recordCommentReopened({
  comment,
  presentation,
  actor,
  ctx,
}) {
  const context = ctx || createRouteContext(actor);

  return createActivityEvent({
    eventType: EVENT_TYPES.COMMENT_REOPENED,
    entityType: ENTITY_TYPES.COMMENT,
    entityId: comment.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      presentationTitle: presentation.title,
      slideId: comment.slideId,
    },
  }, context);
}

/**
 * Record a share link accessed event.
 */
export async function recordShareAccessed({
  shareLink,
  presentation,
  guest,
  ctx,
}) {
  const context = ctx || createRouteContext(null);

  return createActivityEvent({
    eventType: EVENT_TYPES.SHARE_ACCESSED,
    entityType: ENTITY_TYPES.SHARE_LINK,
    entityId: shareLink.id,
    presentationId: presentation.id,
    actorEmail: guest?.email || 'anonymous',
    actorName: guest?.name || 'Anonymous',
    actorType: ACTOR_TYPES.GUEST,
    data: {
      presentationTitle: presentation.title,
      shareLinkName: shareLink.name,
    },
  }, context);
}

/**
 * Queue notifications for comment recipients.
 * Determines who should be notified based on comment context.
 */
export async function queueCommentNotifications({
  comment,
  presentation,
  parentComment,
  actor,
  eventId,
  ctx,
}) {
  const context = ctx || createRouteContext(actor);
  const actorEmail = actor?.email?.toLowerCase();

  // Build recipient list
  const recipients = new Set();

  // Always notify owner
  if (presentation.ownerEmail) {
    recipients.add(presentation.ownerEmail.toLowerCase());
  }

  // If reply, notify parent comment author
  if (parentComment?.authorEmail) {
    recipients.add(parentComment.authorEmail.toLowerCase());
  }

  // Don't notify yourself
  if (actorEmail) {
    recipients.delete(actorEmail);
  }

  // Queue email notifications for each recipient
  const results = [];
  for (const recipientEmail of recipients) {
    const result = await queueNotification({
      recipientEmail,
      eventId,
      channel: 'email',
    }, context);
    results.push(result);
  }

  return results;
}