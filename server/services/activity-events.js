/**
 * Activity events service - helper functions for recording events.
 * Use this module to emit events from route handlers.
 */

import {
  createActivityEvent,
  EVENT_TYPES,
  ENTITY_TYPES,
  ACTOR_TYPES,
} from '../storage/activity-events.js';
import { stripMentionMarkup } from '../../shared/comment-mentions.js';

/**
 * Record a presentation created event.
 */
export async function recordPresentationCreated({
  presentation,
  actor,
  scope,
}) {
  return createActivityEvent(scope, {
    eventType: EVENT_TYPES.PRESENTATION_CREATED,
    entityType: ENTITY_TYPES.PRESENTATION,
    entityId: presentation.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      title: presentation.title,
      visibility: presentation.visibility,
    },
  });
}

/**
 * Record a presentation updated event.
 */
export async function recordPresentationUpdated({
  presentation,
  actor,
  changes,
  scope,
}) {
  return createActivityEvent(scope, {
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
  });
}

/**
 * Record slides added to a deck during a save. Emitted for decks of any visibility
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
 * @param {import('../storage/scope.js').StorageScope} args.scope - the caller's storage scope
 * @returns {Promise<object|null>}
 */
export async function recordSlidesAdded({
  presentation,
  actor,
  slideIds,
  scope,
}) {
  const ids = Array.isArray(slideIds) ? slideIds.filter(Boolean) : [];
  if (ids.length === 0) return null;

  return createActivityEvent(scope, {
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
  });
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
  scope,
}) {
  return createActivityEvent(scope, {
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
  });
}

/**
 * Record a presentation deleted event.
 */
export async function recordPresentationDeleted({
  presentation,
  actor,
  scope,
}) {
  return createActivityEvent(scope, {
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
  });
}

/**
 * Record a presentation moved-to-organization event.
 */
export async function recordPresentationMovedToOrganization({
  presentation,
  actor,
  previousVisibility,
  scope,
}) {
  return createActivityEvent(scope, {
    eventType: EVENT_TYPES.PRESENTATION_MOVED_TO_ORGANIZATION,
    entityType: ENTITY_TYPES.PRESENTATION,
    entityId: presentation.id,
    presentationId: presentation.id,
    actorEmail: actor?.email,
    actorName: actor?.name || actor?.email,
    actorType: ACTOR_TYPES.USER,
    data: {
      title: presentation.title,
      previousVisibility,
      newVisibility: presentation.visibility,
    },
  });
}

/**
 * Record a comment created event.
 */
export async function recordCommentCreated({
  comment,
  presentation,
  actor,
  isGuest,
  scope,
}) {
  const result = await createActivityEvent(scope, {
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
      // Strip mention markup so the preview reads "@Name", not the raw
      // `@[Name](user:email)` marker (surfaced in the home rail + Activity feed,
      // which render this preview as plain text). Strip before truncating so a
      // 100-char cut never splits a marker mid-token.
      bodyPreview: stripMentionMarkup(comment.body).substring(0, 100),
      isReply: !!comment.parentId,
    },
  });

  return result;
}

/**
 * Record a comment resolved event.
 */
export async function recordCommentResolved({
  comment,
  presentation,
  actor,
  scope,
}) {
  return createActivityEvent(scope, {
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
      // Who wrote the comment being resolved is not rendered anywhere and used
      // to be stored as their address — dropped with D22 rather than reinstated
      // as an id nothing reads.
    },
  });
}

/**
 * Record a comment reopened event.
 */
export async function recordCommentReopened({
  comment,
  presentation,
  actor,
  scope,
}) {
  return createActivityEvent(scope, {
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
  });
}
