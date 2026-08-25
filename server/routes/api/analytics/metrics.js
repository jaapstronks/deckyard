/**
 * Presentation-specific analytics metrics endpoints.
 */

import {
  extractValidatedDateRange,
  parsePaginationParams,
} from '../../../utils/request-validators.js';
import { withPresentationAuth } from '../../../utils/route-middleware.js';
import { publicDeviceLabel } from '../../../analytics/helpers.js';
import { badRequest, serveJson } from '../../../utils/http.js';
import {
  getViewSessionsForPresentation,
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

  const slides = await getDetailedSlideEngagement(presentationId, dateRange);
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

  const heatmap = await getInteractionHeatmapData(presentationId, dateRange);
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

  const journey = await getViewerJourneyData(presentationId, dateRange);
  return (serveJson(res, 200, journey), true);
}

/**
 * GET /api/presentations/:id/analytics/sessions - Get viewer session list.
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

  const { limit, offset } = parsePaginationParams(url.searchParams);
  const dateRange = extractValidatedDateRange(url.searchParams, res, {
    sendError: (r, msg) => badRequest(r, msg),
  });
  if (!dateRange) return true;

  const result = await getViewSessionsForPresentation(presentationId, {
    limit,
    offset,
    ...dateRange,
  });

  const sessions = result.sessions.map(({ sessionToken, ...session }) => ({
    ...session,
    deviceId: publicDeviceLabel(session.deviceId, presentationId),
  }));

  return (serveJson(res, 200, { ...result, sessions }), true);
}
