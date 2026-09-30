/**
 * Route handlers for presentation comments.
 * Allows organization members to annotate slides.
 *
 * This module re-exports all comment handlers from their respective files:
 * - comments-list.js: Read operations (list, get, counts, events)
 * - comments-write.js: Write operations (create, update, delete)
 * - comments-actions.js: State change operations (resolve, reopen, dismiss, apply)
 *
 * Creating a comment is a service (`server/services/comments.js`), shared
 * with the public API and MCP.
 */

// Re-export list/read handlers
export {
  handlePresentationCommentsList,
  handlePresentationCommentGet,
  handlePresentationCommentCounts,
  handlePresentationCommentEvents,
} from './comments-list.js';

// Re-export write handlers
export {
  handlePresentationCommentsCreate,
  handlePresentationCommentUpdate,
  handlePresentationCommentDelete,
} from './comments-write.js';

// Re-export action handlers
export {
  handlePresentationCommentResolve,
  handlePresentationCommentReopen,
  handlePresentationCommentDismiss,
  handlePresentationCommentApply,
  handlePresentationCommentsMarkRead,
} from './comments-actions.js';
