/**
 * A share-link guest's own comment routes, under the share token (B179, D228).
 *
 * GET    /api/share/:token/comments            - List the deck's comments
 * POST   /api/share/:token/comments            - Comment, or reply
 * PUT    /api/share/:token/comments/:commentId - Edit one's own comment
 * DELETE /api/share/:token/comments/:commentId - Delete one's own comment
 *
 * A guest has no account, so nothing behind the login gate reaches them: the
 * signed-in comment routes (`routes/api/presentations/comments-*.js`) name the
 * account and only the account, and these name the guest and only the guest.
 * One path per kind of commenter. Paths and bodies mirror the signed-in ones,
 * so the client swaps the base URL and nothing else.
 *
 * The share token addresses the deck, the `share_guest_session` cookie names
 * who is asking, and `canGuestComment` is the guard on all four: a verified
 * guest on a link to this deck with `comment` permission, not revoked, not
 * expired. Editing and deleting add "their own comment", decided in the
 * service (`canGuestEditComment` / `canGuestDeleteComment`). A guest never
 * resolves, reopens or dismisses: there is no route for it here.
 *
 * The rows join `PUBLIC_ROUTES` (`./public.js`), the anonymous mount before
 * the login gate. No request context on this surface: the write scope is the
 * organization of the guest row (see `getGuestBySessionToken`).
 */

import {
  forbidden,
  requireJsonBody,
  serveJson,
  storageError,
  unauthorized,
} from '../../../utils/http.js';
import { validateShareLink } from '../../../storage/share-links/index.js';
import { getOpenCommentCount } from '../../../storage/presentations/comments.js';
import { canGuestComment } from '../../../utils/presentation-authz/index.js';
import { getGuestFromRequest } from '../../../utils/route-middleware.js';
import {
  commentInputFromBody,
  commentListInputFromQuery,
  createComment,
  editComment,
  listComments,
  removeComment,
} from '../../../services/comments.js';

/**
 * What a refused link means to a guest, by storage reason. The code is the
 * reason itself; this is only the sentence beside it.
 */
const LINK_REFUSALS = {
  revoked: 'This share link has been revoked',
  expired: 'This share link has expired',
  not_found: 'This share link does not exist',
  invalid: 'This share link does not exist',
};

/**
 * The guest a share-token comment request comes from, or `null` with the
 * refusal already sent. The refusals, in order:
 *
 *   - the link itself is gone: its storage reason (`revoked`, `expired`: 410;
 *     `not_found`: 404). The use limit is not checked: it counts opens of the
 *     link (`verify`), and a guest who comments already opened it;
 *   - no verified guest session for *this* link: 401 `unauthorized` (a
 *     session on another link does not carry over);
 *   - the link does not allow commenting (view-only): 403 `forbidden`.
 *
 * @param {{ repoRoot: string|null, req: Object, res: Object }} ctx
 * @param {string} token - The share token from the path.
 * @returns {Promise<{ scope: Object, identity: Object, presentationId: string }|null>}
 *   The write scope, the service identity and the deck the link names.
 */
async function guestCommenter({ repoRoot, req, res }, token) {
  const validation = await validateShareLink(token);
  if (!validation.ok && validation.reason !== 'max_uses_exceeded') {
    storageError(res, validation, LINK_REFUSALS[validation.reason]);
    return null;
  }

  const session = await getGuestFromRequest(req);
  if (session?.shareLink?.token !== token) {
    unauthorized(
      res,
      'Verify your email address through this share link to comment',
    );
    return null;
  }

  const { guest, shareLink, organizationId } = session;
  const presentationId = shareLink.presentationId;
  if (!canGuestComment({ guest, shareLink, presentationId })) {
    forbidden(res, 'This share link does not allow commenting');
    return null;
  }

  return {
    scope: { repoRoot, organizationId, actorEmail: null },
    identity: { guest, shareLink },
    presentationId,
  };
}

/** GET /api/share/:token/comments — the deck's comments, as the guest reads them. */
async function handleGuestCommentsList({ repoRoot, req, res, url }, token) {
  const commenter = await guestCommenter({ repoRoot, req, res }, token);
  if (!commenter) return true;
  const { scope, identity, presentationId } = commenter;

  const { comments } = await listComments(
    scope,
    identity,
    commentListInputFromQuery(presentationId, url.searchParams),
  );
  const openCount = await getOpenCommentCount(scope, presentationId);
  serveJson(res, 200, { ok: true, comments, openCount });
  return true;
}

/**
 * POST /api/share/:token/comments — comment, or reply.
 * Body: { body, slideId?, parentId?, positionX?, positionY? }
 */
async function handleGuestCommentCreate({ repoRoot, req, res }, token) {
  const commenter = await guestCommenter({ repoRoot, req, res }, token);
  if (!commenter) return true;
  const { scope, identity, presentationId } = commenter;

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const created = await createComment(
    scope,
    identity,
    commentInputFromBody(presentationId, parsed.body),
  );
  serveJson(res, 201, { ok: true, comment: created.comment });
  return true;
}

/** PUT /api/share/:token/comments/:commentId — edit one's own comment. Body: { body } */
async function handleGuestCommentUpdate(
  { repoRoot, req, res },
  token,
  commentId,
) {
  const commenter = await guestCommenter({ repoRoot, req, res }, token);
  if (!commenter) return true;
  const { scope, identity, presentationId } = commenter;

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const result = await editComment(scope, identity, {
    presentationId,
    commentId,
    body: parsed.body?.body,
  });
  serveJson(res, 200, result);
  return true;
}

/** DELETE /api/share/:token/comments/:commentId — delete one's own comment. */
async function handleGuestCommentDelete(
  { repoRoot, req, res },
  token,
  commentId,
) {
  const commenter = await guestCommenter({ repoRoot, req, res }, token);
  if (!commenter) return true;
  const { scope, identity, presentationId } = commenter;

  const result = await removeComment(scope, identity, {
    presentationId,
    commentId,
  });
  serveJson(res, 200, result);
  return true;
}

/**
 * The guest's comment rows, spread into `PUBLIC_ROUTES`. Form A like the rest
 * of that table: a method mismatch falls through.
 * @type {import('../../../utils/router.js').Route[]}
 */
export const GUEST_COMMENT_ROUTES = [
  {
    method: 'GET',
    pattern: /^\/api\/share\/([^/]+)\/comments$/,
    captures: ['text'],
    handler: handleGuestCommentsList,
  },
  {
    method: 'POST',
    pattern: /^\/api\/share\/([^/]+)\/comments$/,
    captures: ['text'],
    handler: handleGuestCommentCreate,
  },
  {
    method: 'PUT',
    pattern: /^\/api\/share\/([^/]+)\/comments\/([^/]+)$/,
    captures: ['text', 'uuid'],
    handler: handleGuestCommentUpdate,
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/share\/([^/]+)\/comments\/([^/]+)$/,
    captures: ['text', 'uuid'],
    handler: handleGuestCommentDelete,
  },
];
