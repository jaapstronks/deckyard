/**
 * Presentation-specific analytics metrics endpoints.
 */

import { extractValidatedDateRange } from '../../../utils/request-validators.js';
import { listPageResult, parseListPage } from '../../../services/list-page.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { publicDeviceLabel } from '../../../analytics/helpers.js';
import { badRequest, serveJson } from '../../../utils/http.js';
import {
  listViewSessions,
  getPresentationAnalyticsOverview,
  getDetailedSlideEngagement,
  getInteractionHeatmapData,
  getViewerJourneyData,
} from '../../../storage/analytics/index.js';

/**
 * GET /api/presentations/:id/analytics - Get overview metrics.
 */
export async function handleOverview(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => badRequest(r, msg),
  });
  if (!dateRange) return true;

  const overview = await getPresentationAnalyticsOverview(
    ctx.storageScope,
    presentationId,
    dateRange,
  );
  return (serveJson(res, 200, overview), true);
}

/**
 * GET /api/presentations/:id/analytics/slides - Get per-slide engagement.
 */
export async function handleSlides(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => badRequest(r, msg),
  });
  if (!dateRange) return true;

  const slides = await getDetailedSlideEngagement(
    ctx.storageScope,
    presentationId,
    dateRange,
  );
  return (serveJson(res, 200, { slides }), true);
}

/**
 * GET /api/presentations/:id/analytics/heatmap - Get interaction heatmap.
 */
export async function handleHeatmap(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => badRequest(r, msg),
  });
  if (!dateRange) return true;

  const heatmap = await getInteractionHeatmapData(
    ctx.storageScope,
    presentationId,
    dateRange,
  );
  return (serveJson(res, 200, { slides: heatmap }), true);
}

/**
 * GET /api/presentations/:id/analytics/journey - Get viewer journey data.
 */
export async function handleJourney(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => badRequest(r, msg),
  });
  if (!dateRange) return true;

  const journey = await getViewerJourneyData(
    ctx.storageScope,
    presentationId,
    dateRange,
  );
  return (serveJson(res, 200, journey), true);
}

/**
 * GET /api/presentations/:id/analytics/sessions - One page of the viewer
 * sessions in the date window (list-page contract, D358): `{ limit, cursor }`
 * in, `{ sessions, nextCursor }` out, newest first. The window is the
 * cursor's fingerprint. How many there are is the overview's `totalViews`.
 *
 * Readable by every reader of the deck, so two fields are narrowed here at the
 * response boundary, not in the storage mapper (internal callers —
 * heartbeat/end/lookup-by-token — still need the raw shapes):
 *
 *   - `deviceId` is replaced by a per-deck label (see `publicDeviceLabel`):
 *     stable within this deck, unrelated to the label the same browser gets in
 *     someone else's deck. Same field name, derived value.
 *   - `sessionToken` is dropped entirely. It is the proof-of-possession a
 *     viewer's browser uses to update or (under the erasure path) delete its own
 *     session, so it must not be handed to every reader of the deck.
 */
export async function handleSessions(ctx, presentationId) {
  const { res, url, authedUser } = ctx;

  const pres = await withPresentationAuth({
    storageScope: ctx.storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'read',
  });
  if (!pres) return true;

  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => badRequest(r, msg),
  });
  if (!dateRange) return true;
  const page = parseListPage(url.searchParams, {
    sortKey: 'started_desc',
    filters: { since: dateRange.since, until: dateRange.until },
    defaultLimit: 20,
  });

  const result = await listViewSessions(ctx.storageScope, presentationId, {
    limit: page.limit,
    after: page.after,
    ...dateRange,
  });

  const { sessions, nextCursor } = listPageResult('sessions', result, page);
  return (
    serveJson(res, 200, {
      sessions: sessions.map(({ sessionToken, ...session }) => ({
        ...session,
        deviceId: publicDeviceLabel(session.deviceId, presentationId),
      })),
      nextCursor,
    }),
    true
  );
}
