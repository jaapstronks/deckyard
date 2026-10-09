/**
 * Action route handlers for presentation comments.
 * Includes resolve, reopen, dismiss, and apply operations. The status changes
 * are `services/comments.js` (B569); apply is internal-only and stays here.
 */

import {
  getPresentation as getFullPresentation,
  updatePresentation,
} from '../../../storage/presentations/index.js';
import {
  badRequest,
  methodNotAllowed,
  notFound,
  requireJsonBody,
  serveJson,
  storageError,
  forbidden,
} from '../../../utils/http.js';
import { canResolveComment } from '../../../utils/presentation-authz/index.js';
import {
  getComment,
  resolveComment,
  markThreadsRead,
} from '../../../storage/presentations/comments.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import {
  withPresentationAuth,
  withPresentationReadAuth,
} from '../../../utils/route-middleware.js';
import {
  broadcastCommentCounts,
  setCommentStatus,
} from '../../../services/comments.js';
import { fireAndForget } from '../../../utils/fire-and-forget.js';
import { loadDeckTheme } from '../../../utils/themes.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';
import { newSlide } from '../../../../shared/slide-types/presentation.js';
import { insertAfterAnchor } from '../../../services/slides.js';
import { resolveSlideTypeName } from '../../../../shared/slide-types/registry.js';

/**
 * Resolve, reopen or dismiss a comment: the internal adapter over
 * `setCommentStatus` (`services/comments.js`), which decides who may and which
 * transition is allowed. A refusal is thrown and the API error handler renders
 * it.
 *
 * @param {'resolved'|'open'|'dismissed'} status
 */
function statusRoute(status) {
  return async ({ storageScope, req, res, authedUser } = {}, id, commentId) => {
    if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
    const { comment } = await setCommentStatus(
      storageScope,
      { actor: authedUser },
      { presentationId: id, commentId, status },
    );
    serveJson(res, 200, { ok: true, comment });
    return true;
  };
}

/**
 * Resolve a comment.
 * POST /api/presentations/:id/comments/:commentId/resolve
 */
export const handlePresentationCommentResolve = statusRoute('resolved');

/**
 * Reopen a resolved comment.
 * POST /api/presentations/:id/comments/:commentId/reopen
 */
export const handlePresentationCommentReopen = statusRoute('open');

/**
 * Dismiss an AI suggestion.
 * POST /api/presentations/:id/comments/:commentId/dismiss
 *
 * Different from resolve - used specifically for AI suggestions the user doesn't want to act on.
 */
export const handlePresentationCommentDismiss = statusRoute('dismissed');

/**
 * Apply an AI suggestion - create the proposed slide.
 * POST /api/presentations/:id/comments/:commentId/apply
 *
 * For suggestions with proposedSlide data, this creates a new slide
 * after the slide referenced by the comment's slideId.
 */
export async function handlePresentationCommentApply(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
  commentId,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await withPresentationAuth({
    storageScope,
    id,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const comment = await getComment(storageScope, commentId);

  if (!comment || comment.presentationId !== id) {
    return notFound(res, 'Comment not found');
  }

  // Only owner/admin can apply suggestions
  if (!canResolveComment({ user: authedUser, pres, comment })) {
    return forbidden(res);
  }

  // Verify comment has proposedSlide data
  if (
    !comment.proposedSlide ||
    !comment.proposedSlide.type ||
    !comment.proposedSlide.content
  ) {
    return badRequest(res, 'This suggestion does not have a proposed slide');
  }

  // Get the full presentation to modify
  const fullPres = await getFullPresentation(storageScope, id);
  if (!fullPres) return notFound(res, 'Presentation not found');

  // Find the slide referenced by the comment
  const slides = fullPres.slides || [];
  const originalSlideIndex = slides.findIndex((s) => s.id === comment.slideId);

  if (originalSlideIndex === -1) {
    return badRequest(res, 'Referenced slide not found');
  }

  // The proposal names a type the way an agent wrote it; fold the spelling to
  // this org's registry key. A type the org does not have is refused, not
  // repaired: the suggestion stays open for a human to dismiss.
  const slideTypes = await buildMergedSlideTypes(storageScope);
  const type = resolveSlideTypeName(comment.proposedSlide.type, slideTypes);
  if (!type) {
    return badRequest(
      res,
      `This suggestion proposes an unknown slide type: ${comment.proposedSlide.type}`,
    );
  }

  // The proposed content is a patch over the type's defaults, composed by the
  // one factory every other creation route uses.
  const proposed = newSlide({
    type,
    theme: await loadDeckTheme(repoRoot, fullPres.theme, storageScope),
    lang: fullPres.lang,
    presentationId: id,
    slideTypes,
    content: comment.proposedSlide.content,
  });

  // Insert the new slide after the original slide, in its group (D325)
  const updatedSlides = [...slides];
  const newSlideIndex = insertAfterAnchor(
    updatedSlides,
    proposed,
    originalSlideIndex,
  );

  // Update the presentation
  fullPres.slides = updatedSlides;
  await updatePresentation(storageScope, id, fullPres, storageScope);

  // Mark the suggestion as resolved
  const resolveResult = await resolveComment(storageScope, commentId, {
    email: authedUser?.email,
  });

  // Broadcast comment update
  if (resolveResult.ok) {
    broadcastToPresentation(id, CommentEventTypes.RESOLVED, {
      comment: resolveResult.comment,
    });
  }
  fireAndForget(
    broadcastCommentCounts(id, storageScope),
    'broadcast comment counts',
  );

  serveJson(res, 200, {
    ok: true,
    newSlideId: proposed.id,
    originalSlideId: comment.slideId,
    originalSlideIndex,
    newSlideIndex,
  });
  return true;
}
/**
 * Mark comment threads as read for the current user (batch).
 * POST /api/presentations/:id/comments/mark-read
 * Body: { commentIds: string[] }
 *
 * Personal read-state, not a thread status: nothing shared changes. Guests
 * have no account and therefore no read-state; their calls are a cheap no-op
 * so the client doesn't need a special guest path.
 */
export async function handlePresentationCommentsMarkRead(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { pres } = await withPresentationReadAuth({
    storageScope,
    req,
    id,
    authedUser,
    res,
  });
  if (!pres) return true;

  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const commentIds = jsonResult.body?.commentIds;
  if (!Array.isArray(commentIds)) {
    return badRequest(res, 'commentIds array is required');
  }
  if (commentIds.length > 500) {
    return badRequest(res, 'Too many commentIds (max 500)');
  }

  const result = await markThreadsRead(storageScope, id, commentIds);
  if (!result.ok) {
    return storageError(res, result);
  }

  serveJson(res, 200, { ok: true, marked: result.marked });
  return true;
}
