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

export async function handleFollowPublic({ repoRoot, req, res, url }) {
  const stateMatch = url.pathname.match(/^\/api\/follow\/([^/]+)\/state$/);
  if (stateMatch) return handleFollowState({ repoRoot, req, res, url }, stateMatch[1]);

  const interactionsCurrentMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/interactions\/current$/
  );
  if (interactionsCurrentMatch)
    return handleFollowInteractionsCurrent(
      { repoRoot, req, res, url },
      interactionsCurrentMatch[1]
    );

  const interactionStateMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/state$/
  );
  if (interactionStateMatch)
    return handleFollowInteractionState(
      { repoRoot, req, res, url },
      interactionStateMatch[1],
      interactionStateMatch[2]
    );

  const interactionVoteMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/vote$/
  );
  if (interactionVoteMatch)
    return handleFollowInteractionVote(
      { repoRoot, req, res, url },
      interactionVoteMatch[1],
      interactionVoteMatch[2]
    );

  const interactionFeedbackMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/interactions\/([^/]+)\/feedback$/
  );
  if (interactionFeedbackMatch)
    return handleFollowInteractionFeedback(
      { repoRoot, req, res, url },
      interactionFeedbackMatch[1],
      interactionFeedbackMatch[2]
    );

  const questionsMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/questions$/
  );
  if (questionsMatch)
    return handleFollowQuestions({ repoRoot, req, res, url }, questionsMatch[1]);

  const questionsEventsMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/questions\/events$/
  );
  if (questionsEventsMatch)
    return handleFollowQuestionsEvents(
      { repoRoot, req, res, url },
      questionsEventsMatch[1]
    );

  const upvoteMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/questions\/([^/]+)\/upvote$/
  );
  if (upvoteMatch)
    return handleFollowUpvote(
      { repoRoot, req, res, url },
      upvoteMatch[1],
      upvoteMatch[2]
    );

  const cancelMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/questions\/([^/]+)\/cancel$/
  );
  if (cancelMatch)
    return handleFollowCancel(
      { repoRoot, req, res, url },
      cancelMatch[1],
      cancelMatch[2]
    );

  const presMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/presentation$/
  );
  if (presMatch)
    return handleFollowPresentation({ repoRoot, req, res, url }, presMatch[1]);

  const eventsMatch = url.pathname.match(
    /^\/api\/follow\/([^/]+)\/events$/
  );
  if (eventsMatch)
    return handleFollowEvents({ repoRoot, req, res, url }, eventsMatch[1]);

  return false;
}
