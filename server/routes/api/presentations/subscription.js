/**
 * Per-deck notification subscription routes (phase 4 of the comments &
 * notifications plan).
 *
 *   GET /api/presentations/:id/subscription - current override + default
 *   PUT /api/presentations/:id/subscription - set or clear the override
 *       Body: { level: 'watching'|'participating'|'mentions_only'|'mute'|null }
 *
 * Personal state: needs read access to the deck and an account (guests
 * have no subscriptions).
 */

import {
  methodNotAllowed,
  serveJson,
  unauthorized,
  badRequest,
  requireJsonBody,
} from '../../../utils/http.js';
import { withPresentationReadAuth } from '../../../utils/route-middleware.js';
import {
  getSubscription,
  setSubscription,
  SUBSCRIPTION_LEVELS,
} from '../../../storage/presentation-subscriptions.js';
import { readUserSettings } from '../../../storage/settings.js';
import { getCtx } from './comments-shared.js';

export async function handlePresentationSubscription(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'GET' && req.method !== 'PUT') {
    return methodNotAllowed(res, ['GET', 'PUT']);
  }

  const { pres } = await withPresentationReadAuth({ repoRoot, req, id, authedUser, res });
  if (!pres) return true;

  if (!authedUser?.email) {
    return unauthorized(res);
  }

  const ctx = getCtx(authedUser);

  if (req.method === 'GET') {
    const sub = await getSubscription(id, authedUser.email, ctx);
    const settings = await readUserSettings(repoRoot, authedUser.email);
    serveJson(res, 200, {
      ok: true,
      level: sub?.level || null,
      defaultLevel: settings?.notifications?.defaultLevel || 'participating',
    });
    return true;
  }

  // PUT
  const jsonResult = await requireJsonBody(req, res);
  if (!jsonResult.ok) return true;
  const level = jsonResult.body?.level ?? null;
  if (level !== null && !SUBSCRIPTION_LEVELS.includes(level)) {
    return badRequest(res, `level must be one of ${SUBSCRIPTION_LEVELS.join('|')} or null`);
  }

  const result = await setSubscription(id, authedUser.email, level, ctx);
  if (!result.ok) {
    return serveJson(res, result.reason === 'unavailable' ? 503 : 400, result);
  }

  serveJson(res, 200, { ok: true, level: result.level });
  return true;
}
