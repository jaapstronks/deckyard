import {
  getPresentation,
  updatePresentation,
} from '../../../storage/presentations/index.js';
import {
  badRequest,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  jsonError,
  requireJsonBody,
} from '../../../utils/http.js';
import {
  canChangePresentationVisibility,
  isPresentationAuthor,
} from '../../../utils/presentation-authz.js';
import { maybeFireWebhook } from '../../../utils/webhooks.js';
import { parseIfMatchRevision } from './helpers.js';
import { getOptionalBoolean } from '../../../utils/request-validators.js';

export async function handlePresentationVisibility(
  { repoRoot, storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'PATCH') return methodNotAllowed(res, ['PATCH']);
  const existing = await getPresentation(storageScope, id);
  if (!existing) return notFound(res);
  if (!authedUser) return unauthorized(res);

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const nextVisibility =
    body?.visibility === 'organization'
      ? 'organization'
      : body?.visibility === 'private'
        ? 'private'
        : null;
  if (!nextVisibility) return badRequest(res, 'Invalid visibility');
  if (
    !canChangePresentationVisibility({
      user: authedUser,
      pres: existing,
      nextVisibility,
    })
  )
    return unauthorized(res);

  // Handle isViewOnly flag (only when sharing to the organization)
  let nextIsViewOnly = existing.isViewOnly || false;
  const isViewOnly = getOptionalBoolean(body, 'isViewOnly');
  if (isViewOnly !== null) {
    // Only owner/creator can toggle view-only status
    if (!isPresentationAuthor({ user: authedUser, pres: existing })) {
      return unauthorized(res, 'Only the owner can set view-only status');
    }
    // View-only requires organization visibility
    if (isViewOnly && nextVisibility !== 'organization') {
      return badRequest(
        res,
        'View-only presentations must be visible to the organization',
      );
    }
    nextIsViewOnly = isViewOnly;
  }

  // If moving to private, automatically remove view-only status
  if (nextVisibility === 'private') {
    nextIsViewOnly = false;
  }

  // If-Match required for everyone, admins included (escape hatch removed).
  const expectedRevision = parseIfMatchRevision(req);
  if (expectedRevision == null)
    return jsonError(res, 428, 'missing_if_match', 'Missing If-Match revision');

  const nextPres = {
    ...existing,
    visibility: nextVisibility,
    isViewOnly: nextIsViewOnly,
  };
  // Optimistic-lock failures (ConflictError/LockedError from
  // updatePresentation) are AppErrors — the withErrorHandler wrapper on the
  // presentations dispatcher emits them through the canonical envelope.
  const updated = await updatePresentation(storageScope, id, nextPres, {
    expectedRevision,
    actorEmail: authedUser?.email || null,
    allowVisibilityChange: true,
    allowViewOnlyChange: true,
  });

  if (
    existing?.visibility !== 'organization' &&
    updated?.visibility === 'organization'
  ) {
    await maybeFireWebhook(repoRoot, req, {
      event: 'presentation.moved_to_organization',
      pres: updated,
      authedUser,
      extra: {
        fromVisibility: existing?.visibility || 'private',
        toVisibility: 'organization',
      },
    });
  }
  serveJson(res, 200, updated);
  return true;
}
