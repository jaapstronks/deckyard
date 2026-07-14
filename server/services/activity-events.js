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