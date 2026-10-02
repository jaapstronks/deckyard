/**
 * Comments - the feature's public seam, shared by the editor's comments
 * panel, the preview lightbox and the share viewer: who may act on a comment,
 * rendering a stored body, the rich input with its link button and the
 * mention autocomplete.
 */

export {
  isCommentAuthor,
  isCommentOwner,
  isGuestCommentAuthor,
} from './comment-authz.js';
export { renderCommentBodyNodes } from './comment-body.js';
export { createRichCommentInput } from './comment-rich-input.js';
export { createCommentLinkButton } from './comment-toolbar.js';
export { attachMentionAutocomplete } from './mention-autocomplete.js';
