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

import { dispatchRoutes } from '../../utils/router.js';
import { handleFollowState } from './follow/state.js';
import {
  handleFollowCancel,
  handleFollowQuestions,
  handleFollowUpvote,
} from './follow/questions.js';
import { handleFollowQuestionsEvents } from './follow/questions-events.js';
import { handleFollowPresentation } from './follow/presentation.js';
import { handleFollowEvents } from './follow/events.js';
import {
  handleFollowInteractionsCurrent,
  handleFollowInteractionState,
  handleFollowInteractionVote,
  handleFollowInteractionFeedback,
} from './follow/interactions.js';

/** @type {import('../../utils/router.js').Route[]} */
export const ROUTES = [
  { pattern: /^\/api\/follow\/([^/]+)\/state$/, handler: handleFollowState },
  { pattern: /^\/api\/follow\/([^/]+)\/interactions\/current$/, handler: handleFollowInteractionsCurrent },
  { pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/state$/, handler: handleFollowInteractionState },
  { pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/vote$/, handler: handleFollowInteractionVote },
  { pattern: /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/feedback$/, handler: handleFollowInteractionFeedback },
  { pattern: /^\/api\/follow\/([^/]+)\/questions$/, handler: handleFollowQuestions },
  { pattern: /^\/api\/follow\/([^/]+)\/questions\/events$/, handler: handleFollowQuestionsEvents },
  { pattern: /^\/api\/follow\/([^/]+)\/questions\/([^/]+)\/upvote$/, handler: handleFollowUpvote },
  { pattern: /^\/api\/follow\/([^/]+)\/questions\/([^/]+)\/cancel$/, handler: handleFollowCancel },
  { pattern: /^\/api\/follow\/([^/]+)\/presentation$/, handler: handleFollowPresentation },
  { pattern: /^\/api\/follow\/([^/]+)\/events$/, handler: handleFollowEvents },
];

/**
 * Handle public follow endpoints.
 * @param {import('../../utils/context.js').PublicContext} ctx
 */
export async function handleFollowPublic(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
