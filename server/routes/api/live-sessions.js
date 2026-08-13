import {
  broadcastBranch,
  createLiveSession,
  getLiveSession,
  sendLiveSessionControlCommand,
  setLiveSessionControlEnabled,
  updateLiveSessionState,
} from '../../storage/live-sessions/index.js';
import {
  ensurePollInteractionForSlide,
  resetPollInteraction,
  setPollInteractionStatus,
  ensureLikertInteractionForSlide,
  resetLikertInteraction,
  setLikertInteractionStatus,
} from '../../storage/interactions.js';
import {
  ensureFeedbackForSlide,
  resetFeedback,
  setFeedbackStatus,
  listFeedbackEntries,
} from '../../storage/feedback.js';
import {
  badRequest,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
  requireJsonBody,
} from '../../utils/http.js';
import {
  findSlideById,
  getOptionCountForSlide,
} from '../../utils/interaction-helpers.js';
import { liveInteractionKind } from '../../../shared/slide-types/runtime.js';
import { withPresentationAuth } from '../../utils/route-middleware.js';
import { dispatchRoutes } from '../../utils/router.js';
import { getString, getOptionalBoolean } from '../../utils/request-validators.js';

/**
 * Presenter-only live-session routes.
 *
 * Everything here requires deck-write. The capability-based half of the surface
 * — the audience/companion reads, the SSE stream and the session-scoped notes
 * write — lives in `live-session-audience.js` and is dispatched from the
 * public block, before the login gate.
 */

/**
 * Require the caller to be allowed to write (present/control) the presentation
 * backing this session. Present-session control, state pushes, interaction
 * open/close and feedback export are presenter-only actions; without this a
 * logged-in non-owner could resolve a public follow-code to a presentationId,
 * obtain the live sessionId, and drive someone else's deck or exfiltrate
 * audience PII. Audience reads (state GET, SSE) stay capability-based.
 *
 * @returns {Promise<Object|null>} the presentation if authorized, or null after
 *   the helper has already sent a 404/401 response.
 */
async function requirePresentationControl({ storageScope, presentationId, authedUser, res }) {
  return withPresentationAuth({
    storageScope,
    id: presentationId,
    authedUser,
    res,
    permission: 'write',
  });
}

function csvEscapeCell(v) {
  const s = String(v ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r'))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// POST /api/live-sessions - Create/resume a live session (deck-write only)
async function handleLiveSessionCreate({ storageScope, req, res, authedUser }) {
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const presentationId = getString(body, 'presentationId');
  if (!presentationId.trim())
    return badRequest(res, 'Expected { presentationId: string }');
  // Only someone who can write the deck may create/resume its live session.
  // Otherwise the returned sessionId hands live control to a non-owner.
  const pres = await requirePresentationControl({
    storageScope,
    presentationId: presentationId.trim(),
    authedUser,
    res,
  });
  if (!pres) return true;
  const created = await createLiveSession(storageScope, {
    presentationId: presentationId.trim(),
  });
  if (!created)
    return badRequest(res, 'Expected { presentationId: string }');
  serveJson(res, 201, created);
  return true;
}

// /api/live-sessions/:id/state - Push live state (presenter only). The
// session-existence check answers 404 before the method decision (an unknown
// session must not learn which methods exist), so the whole path stays one
// no-method handler (route-dispatch.md, guard-before-method exception).
async function handleLiveSessionStatePush({ storageScope, req, res, authedUser }, sessionId) {
  const s = await getLiveSession(storageScope, sessionId);
  if (!s) return notFound(res);
  // GET is capability-based (the session id is the authorization) and is
  // served from the public block — see routes/api/live-session-audience.js.
  if (req.method === 'POST') {
    // Pushing live state is a presenter action → require deck-write.
    const pres = await requirePresentationControl({
      storageScope,
      presentationId: s.presentationId,
      authedUser,
      res,
    });
    if (!pres) return true;
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    const presentationId = getString(body, 'presentationId');
    if (!presentationId.trim() || presentationId.trim() !== s.presentationId)
      return badRequest(res, 'presentationId mismatch');
    const slideId = getString(body, 'slideId');
    const slideType = getString(body, 'slideType');
    const slideIndex = Number(body?.slideIndex ?? NaN);
    if (!Number.isFinite(slideIndex))
      return badRequest(res, 'slideIndex must be a number');
    const stepIdxRaw = body?.stepIdx;
    const stepIdx =
      stepIdxRaw == null ? undefined : Number(stepIdxRaw ?? NaN);
    if (stepIdx != null && !Number.isFinite(stepIdx))
      return badRequest(res, 'stepIdx must be a number');
    const stepParagraphs = getOptionalBoolean(body, 'stepParagraphs') ?? undefined;
    const updatedAt =
      body?.updatedAt != null ? Number(body.updatedAt) : Date.now();
    const next = await updateLiveSessionState(storageScope, sessionId, {
      slideId,
      slideIndex,
      slideType,
      stepIdx: stepIdx != null ? Math.max(0, stepIdx) : undefined,
      stepParagraphs,
      updatedAt,
    });

    // If this is a live slide, eagerly ensure interaction state exists so the
    // presenter can show live results immediately (even before the first vote).
    try {
      const kind = liveInteractionKind(slideType);
      if (kind && slideId) {
        // Reuse the authorized presentation loaded above (presentationId is
        // validated to equal s.presentationId), avoiding a second read.
        const slide = pres ? findSlideById(pres, slideId) : null;
        if (kind === 'feedback') {
          await ensureFeedbackForSlide(storageScope, sessionId, {
            slideId,
          });
        } else {
          const optionCount = getOptionCountForSlide(slideType, slide);
          if (optionCount > 0) {
            if (kind === 'likert') {
              await ensureLikertInteractionForSlide(storageScope, sessionId, {
                slideId,
                optionCount,
              });
            } else {
              await ensurePollInteractionForSlide(storageScope, sessionId, {
                slideId,
                optionCount,
              });
            }
          }
        }
      }
    } catch {
      // ignore
    }

    serveJson(res, 200, next);
    return true;
  }
  return methodNotAllowed(res, ['GET', 'POST']);
}

// POST /api/live-sessions/:id/interactions/:slideId/(open|close|reset)
async function handleLiveSessionInteractionAction({ storageScope, res, authedUser }, sessionId, slideId, action) {
  const s = await getLiveSession(storageScope, sessionId);
  if (!s) return notFound(res);
  // Opening/closing/resetting an interaction is a presenter action.
  const pres = await requirePresentationControl({
    storageScope,
    presentationId: s.presentationId,
    authedUser,
    res,
  });
  if (!pres) return true;
  const slide = findSlideById(pres, slideId);
  if (!slide) return badRequest(res, 'slide not found');
  const slideType = String(slide?.type || '');
  // Opening, closing and resetting is the same action for every live type;
  // only the store it reaches differs, which is what the kind selects.
  const kind = liveInteractionKind(slideType);
  if (!kind) return badRequest(res, 'slide is not interactive');
  const optionCount = getOptionCountForSlide(slideType, slide);
  if (kind !== 'feedback' && !optionCount)
    return badRequest(
      res,
      kind === 'likert' ? 'likert has no options' : 'poll has no options'
    );

  // Ensure interaction exists first.
  if (kind === 'feedback') {
    await ensureFeedbackForSlide(storageScope, sessionId, {
      slideId,
    });
  } else if (kind === 'likert') {
    await ensureLikertInteractionForSlide(storageScope, sessionId, {
      slideId,
      optionCount,
    });
  } else {
    await ensurePollInteractionForSlide(storageScope, sessionId, {
      slideId,
      optionCount,
    });
  }

  if (action === 'reset') {
    const agg =
      kind === 'feedback'
        ? await resetFeedback(storageScope, sessionId, { slideId })
        : kind === 'likert'
          ? await resetLikertInteraction(storageScope, sessionId, {
              slideId,
              optionCount,
            })
          : await resetPollInteraction(storageScope, sessionId, {
              slideId,
              optionCount,
            });
    serveJson(res, 200, { ok: true, interactionState: agg });
    return true;
  }

  const agg =
    kind === 'feedback'
      ? await setFeedbackStatus(storageScope, sessionId, {
          slideId,
          status: action === 'close' ? 'closed' : 'open',
        })
      : kind === 'likert'
        ? await setLikertInteractionStatus(storageScope, sessionId, {
            slideId,
            status: action === 'close' ? 'closed' : 'open',
            optionCount,
          })
        : await setPollInteractionStatus(storageScope, sessionId, {
            slideId,
            status: action === 'close' ? 'closed' : 'open',
            optionCount,
          });

  // Broadcast branch event when closing an interaction with onClose configured
  if (action === 'close' && kind !== 'feedback') {
    const content = slide?.content || slide?.contentNl || slide?.contentEn || {};
    const onClose = String(content?.onClose || 'stay').trim();
    const onCloseTarget = String(content?.onCloseTarget || '').trim();
    if (onClose !== 'stay') {
      broadcastBranch(storageScope, sessionId, {
        slideId,
        onClose,
        onCloseTarget,
      });
    }
  }

  serveJson(res, 200, { ok: true, interactionState: agg });
  return true;
}

// GET /api/live-sessions/:id/feedback/:slideId.(csv|json) - Export feedback
// (audience PII, deck-write only)
async function handleLiveSessionFeedbackExport({ storageScope, res, authedUser }, sessionId, slideId, fmt) {
  const s = await getLiveSession(storageScope, sessionId);
  if (!s) return notFound(res);
  // Feedback entries are audience PII (free text + deviceId) → deck-write only.
  const pres = await requirePresentationControl({
    storageScope,
    presentationId: s.presentationId,
    authedUser,
    res,
  });
  if (!pres) return true;
  const slide = findSlideById(pres, slideId);
  if (!slide) return badRequest(res, 'slide not found');
  if (liveInteractionKind(String(slide?.type || '')) !== 'feedback')
    return badRequest(res, 'slide is not a feedback slide');

  const entries = await listFeedbackEntries(storageScope, sessionId, { slideId });
  if (fmt === 'json') {
    serveJson(res, 200, {
      ok: true,
      sessionId,
      presentationId: s.presentationId,
      slideId,
      count: entries.length,
      entries,
    });
    return true;
  }

  const header = [
    'slideId',
    'deviceId',
    'createdAt',
    'updatedAt',
    'text',
  ].join(',');
  const lines = entries.map((e) =>
    [
      csvEscapeCell(e.slideId),
      csvEscapeCell(e.deviceId),
      csvEscapeCell(new Date(Number(e.createdAt || 0) || 0).toISOString()),
      csvEscapeCell(new Date(Number(e.updatedAt || 0) || 0).toISOString()),
      csvEscapeCell(e.text),
    ].join(',')
  );
  const body = `${header}\n${lines.join('\n')}\n`;
  const filename = `feedback-${slideId}.csv`;
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${filename}"`,
  });
  res.end(body);
  return true;
}

// POST /api/live-sessions/:id/control/enable - Enable remote control
async function handleLiveSessionControlEnable({ storageScope, res, authedUser }, sessionId) {
  const s = await getLiveSession(storageScope, sessionId);
  if (!s) return notFound(res);
  const pres = await requirePresentationControl({
    storageScope,
    presentationId: s.presentationId,
    authedUser,
    res,
  });
  if (!pres) return true;
  const next = setLiveSessionControlEnabled(storageScope, sessionId, true);
  serveJson(res, 200, next);
  return true;
}

// POST /api/live-sessions/:id/control/disable - Disable remote control
async function handleLiveSessionControlDisable({ storageScope, res, authedUser }, sessionId) {
  const s = await getLiveSession(storageScope, sessionId);
  if (!s) return notFound(res);
  const pres = await requirePresentationControl({
    storageScope,
    presentationId: s.presentationId,
    authedUser,
    res,
  });
  if (!pres) return true;
  const next = setLiveSessionControlEnabled(storageScope, sessionId, false);
  serveJson(res, 200, next);
  return true;
}

// POST /api/live-sessions/:id/control - Send a remote-control command
async function handleLiveSessionControlCommand({ storageScope, req, res, authedUser }, sessionId) {
  const s = await getLiveSession(storageScope, sessionId);
  if (!s) return notFound(res);
  const pres = await requirePresentationControl({
    storageScope,
    presentationId: s.presentationId,
    authedUser,
    res,
  });
  if (!pres) return true;
  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const result = await sendLiveSessionControlCommand(storageScope, sessionId, body);
  if (!result.ok) {
    if (result.reason === 'disabled')
      return unauthorized(
        res,
        'Remote control is disabled for this session'
      );
    return badRequest(res, `Control failed: ${result.reason}`);
  }
  serveJson(res, 200, { ok: true });
  return true;
}

/**
 * Declarative route table for the presenter-only `/api/live-sessions*` routes
 * (A7.19 C8). Order matches the previous if-chain. Every row is method-bearing
 * and falls through on a mismatch (Form A) — deliberately: the GET
 * counterparts of `/state` and the SSE stream are capability-based audience
 * routes served from the public block (`live-session-audience.js`), before
 * the login gate, so a 405 here can never shadow them. The one exception is
 * `/state`, whose session-existence check precedes the method decision — it
 * stays a single no-method handler (guard-before-method).
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'POST', pattern: '/api/live-sessions', handler: handleLiveSessionCreate },
  { pattern: /^\/api\/live-sessions\/([^/]+)\/state$/, handler: handleLiveSessionStatePush },
  { method: 'POST', pattern: /^\/api\/live-sessions\/([^/]+)\/interactions\/([^/]+)\/(open|close|reset)$/, handler: handleLiveSessionInteractionAction },
  { method: 'GET', pattern: /^\/api\/live-sessions\/([^/]+)\/feedback\/([^/]+)\.(csv|json)$/, handler: handleLiveSessionFeedbackExport },
  { method: 'POST', pattern: /^\/api\/live-sessions\/([^/]+)\/control\/enable$/, handler: handleLiveSessionControlEnable },
  { method: 'POST', pattern: /^\/api\/live-sessions\/([^/]+)\/control\/disable$/, handler: handleLiveSessionControlDisable },
  { method: 'POST', pattern: /^\/api\/live-sessions\/([^/]+)\/control$/, handler: handleLiveSessionControlCommand },
];

/**
 * Handle the presenter-only live-session routes.
 *
 * @param {import('../../utils/context.js').AuthedContext} ctx
 * @returns {Promise<boolean>|boolean} true if a route handled the request.
 */
export function handleLiveSessions(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
