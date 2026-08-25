/**
 * Public follow (audience) routes (A7.19 C8 — ROUTES table).
 *
 * Mounted **before** the auth gate: the follow code in the URL is the
 * authorization, so every handler receives a `PublicContext`. The old chain
 * carried no method checks at this level — each sub-handler decides its own
 * methods (and rate/connection limits) internally, so every row is
 * method-less and forwards to the sub-handler unchanged. Table order mirrors
 * the old branch order exactly.
 */

import { dispatchRoutes } from '../../../utils/router.js';
import { notFound, withErrorHandler } from '../../../utils/http.js';
import { isUuid } from '../../../utils/uuid.js';
import { handleFollowState } from './state.js';
import {
  handleFollowCancel,
  handleFollowQuestions,
  handleFollowUpvote,
} from './questions.js';
import { handleFollowQuestionsEvents } from './questions-events.js';
import { handleFollowPresentation } from './presentation.js';
import { handleFollowEvents } from './events.js';
import {
  handleFollowInteractionsCurrent,
  handleFollowInteractionState,
  handleFollowInteractionVote,
  handleFollowInteractionFeedback,
} from './interactions.js';

/**
 * Every row captures the presentation id as its first segment, and the storage
 * underneath queries Postgres `uuid` columns with it verbatim — so a non-uuid
 * id would 500 out of the uuid parser (22P02) before any reason mapping.
 * Shape-check it once, around every handler (A7.19-C7h): an id that cannot be
 * a uuid cannot name a presentation, hence `not_found`.
 *
 * @param {(ctx: object, ...params: string[]) => unknown} handler
 * @returns {(ctx: object, ...params: string[]) => unknown}
 */
const requireUuidId = (handler) => {
  const wrapped = (ctx, presentationId, ...rest) =>
    isUuid(presentationId)
      ? handler(ctx, presentationId, ...rest)
      : notFound(ctx.res);
  // Keep the sub-handler's name visible on the row (the dispatch tests pin it).
  Object.defineProperty(wrapped, 'name', { value: handler.name });
  return wrapped;
};

/** @type {import('../../../utils/router.js').Route[]} */
export const ROUTES = [
  {
    pattern: /^\/api\/follow\/([^/]+)\/state$/,
    handler: requireUuidId(handleFollowState),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/interactions\/current$/,
    handler: requireUuidId(handleFollowInteractionsCurrent),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/state$/,
    handler: requireUuidId(handleFollowInteractionState),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/vote$/,
    handler: requireUuidId(handleFollowInteractionVote),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/feedback$/,
    handler: requireUuidId(handleFollowInteractionFeedback),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/questions$/,
    handler: requireUuidId(handleFollowQuestions),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/questions\/events$/,
    handler: requireUuidId(handleFollowQuestionsEvents),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/questions\/([^/]+)\/upvote$/,
    handler: requireUuidId(handleFollowUpvote),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/questions\/([^/]+)\/cancel$/,
    handler: requireUuidId(handleFollowCancel),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/presentation$/,
    handler: requireUuidId(handleFollowPresentation),
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/events$/,
    handler: requireUuidId(handleFollowEvents),
  },
];

/**
 * Handle public follow endpoints.
 * @param {import('../../../utils/context.js').PublicContext} ctx
 */
export const handleFollowPublic = withErrorHandler('follow', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
