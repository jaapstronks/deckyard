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

import { dispatchRoutes, requireUuidId } from '../../../utils/router.js';
import { withErrorHandler } from '../../../utils/http.js';
import { handleFollowState } from './state.js';
import {
  handleFollowCancel,
  handleFollowQuestions,
  handleFollowUpvote,
} from './questions.js';
import { handleFollowQuestionsEvents } from './questions-events.js';
import { handleFollowPresentation } from './presentation.js';
import { handleFollowEvents } from './events.js';
import { handleFollowRenderSlide } from './render-slide.js';
import {
  handleFollowInteractionsCurrent,
  handleFollowInteractionState,
  handleFollowInteractionVote,
  handleFollowInteractionFeedback,
} from './interactions.js';

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
  {
    pattern: /^\/api\/follow\/([^/]+)\/render-slide$/,
    handler: requireUuidId(handleFollowRenderSlide),
  },
];

/**
 * Handle public follow endpoints.
 * @param {import('../../../utils/context.js').PublicContext} ctx
 */
export const handleFollowPublic = withErrorHandler('follow', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
