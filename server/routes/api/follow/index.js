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

/**
 * Every row declares its `captures` (B222/B360). The first is always the
 * presentation id, a Postgres `uuid`. The second differs per family, and that
 * is why the declaration is per capture rather than per row: the
 * `/interactions/:slideId` rows capture a slide id, which is author-chosen
 * text (migration 051), while `/questions/:questionId` captures `questions.id`,
 * a uuid.
 *
 * @type {import('../../../utils/router.js').Route[]}
 */
export const ROUTES = [
  {
    pattern: /^\/api\/follow\/([^/]+)\/state$/,
    captures: ['uuid'],
    handler: handleFollowState,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/interactions\/current$/,
    captures: ['uuid'],
    handler: handleFollowInteractionsCurrent,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/state$/,
    captures: ['uuid', 'text'],
    handler: handleFollowInteractionState,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/vote$/,
    captures: ['uuid', 'text'],
    handler: handleFollowInteractionVote,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/feedback$/,
    captures: ['uuid', 'text'],
    handler: handleFollowInteractionFeedback,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/questions$/,
    captures: ['uuid'],
    handler: handleFollowQuestions,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/questions\/events$/,
    captures: ['uuid'],
    handler: handleFollowQuestionsEvents,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/questions\/([^/]+)\/upvote$/,
    captures: ['uuid', 'uuid'],
    handler: handleFollowUpvote,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/questions\/([^/]+)\/cancel$/,
    captures: ['uuid', 'uuid'],
    handler: handleFollowCancel,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/presentation$/,
    captures: ['uuid'],
    handler: handleFollowPresentation,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/events$/,
    captures: ['uuid'],
    handler: handleFollowEvents,
  },
  {
    pattern: /^\/api\/follow\/([^/]+)\/render-slide$/,
    captures: ['uuid'],
    handler: handleFollowRenderSlide,
  },
];

/**
 * Handle public follow endpoints.
 * @param {import('../../../utils/context.js').PublicContext} ctx
 */
export const handleFollowPublic = withErrorHandler('follow', (ctx) =>
  dispatchRoutes(ROUTES, ctx),
);
