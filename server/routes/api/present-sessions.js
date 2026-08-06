import {
  broadcastBranch,
  createPresentSession,
  getPresentSession,
  sendPresentSessionControlCommand,
  setPresentSessionControlEnabled,
  updatePresentSessionState,
} from '../../storage/present-sessions/index.js';
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
import { getString } from '../../utils/request-validators.js';

/**
 * Presenter-only present-session routes.
 *
 * Everything here requires deck-write. The capability-based half of the surface
 * — the audience/companion reads, the SSE stream and the session-scoped notes
 * write — lives in `present-session-audience.js` and is dispatched from the
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
async function requirePresentationControl({ repoRoot, presentationId, authedUser, res }) {
  return withPresentationAuth({
    repoRoot,
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

export async function handlePresentSessions({ repoRoot, req, res, url, authedUser }) {
  if (url.pathname === '/api/present-sessions' && req.method === 'POST') {
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    const presentationId = getString(body, 'presentationId');
    if (!presentationId.trim())
      return badRequest(res, 'Expected { presentationId: string }');
    // Only someone who can write the deck may create/resume its live session.
    // Otherwise the returned sessionId hands live control to a non-owner.
    const pres = await requirePresentationControl({
      repoRoot,
      presentationId: presentationId.trim(),
      authedUser,
      res,
    });
    if (!pres) return true;
    const created = await createPresentSession(repoRoot, {
      presentationId: presentationId.trim(),
    });
    if (!created)
      return badRequest(res, 'Expected { presentationId: string }');
    serveJson(res, 201, created);
    return true;
  }

  const sessStateMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/state$/
  );
  if (sessStateMatch) {
    const sessionId = sessStateMatch[1];
    const s = await getPresentSession(repoRoot, sessionId);
    if (!s) return notFound(res);
    // GET is capability-based (the session id is the authorization) and is
    // served from the public block — see routes/api/present-session-audience.js.
    if (req.method === 'POST') {
      // Pushing live state is a presenter action → require deck-write.
      const pres = await requirePresentationControl({
        repoRoot,
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
      const stepParagraphs =
        typeof body?.stepParagraphs === 'boolean'
          ? body.stepParagraphs
          : undefined;
      const updatedAt =
        body?.updatedAt != null ? Number(body.updatedAt) : Date.now();
      const next = await updatePresentSessionState(repoRoot, sessionId, {
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
            await ensureFeedbackForSlide(repoRoot, sessionId, {
              slideId,
            });
          } else {
            const optionCount = getOptionCountForSlide(slideType, slide);
            if (optionCount > 0) {
              if (kind === 'likert') {
                await ensureLikertInteractionForSlide(repoRoot, sessionId, {
                  slideId,
                  optionCount,
                });
              } else {
                await ensurePollInteractionForSlide(repoRoot, sessionId, {
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

  const sessInteractionMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/interactions\/([^/]+)\/(open|close|reset)$/
  );
  if (sessInteractionMatch && req.method === 'POST') {
    const sessionId = sessInteractionMatch[1];
    const slideId = sessInteractionMatch[2];
    const action = sessInteractionMatch[3];
    const s = await getPresentSession(repoRoot, sessionId);
    if (!s) return notFound(res);
    // Opening/closing/resetting an interaction is a presenter action.
    const pres = await requirePresentationControl({
      repoRoot,
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
      await ensureFeedbackForSlide(repoRoot, sessionId, {
        slideId,
      });
    } else if (kind === 'likert') {
      await ensureLikertInteractionForSlide(repoRoot, sessionId, {
        slideId,
        optionCount,
      });
    } else {
      await ensurePollInteractionForSlide(repoRoot, sessionId, {
        slideId,
        optionCount,
      });
    }

    if (action === 'reset') {
      const agg =
        kind === 'feedback'
          ? await resetFeedback(repoRoot, sessionId, { slideId })
          : kind === 'likert'
            ? await resetLikertInteraction(repoRoot, sessionId, {
                slideId,
                optionCount,
              })
            : await resetPollInteraction(repoRoot, sessionId, {
                slideId,
                optionCount,
              });
      serveJson(res, 200, { ok: true, interactionState: agg });
      return true;
    }

    const agg =
      kind === 'feedback'
        ? await setFeedbackStatus(repoRoot, sessionId, {
            slideId,
            status: action === 'close' ? 'closed' : 'open',
          })
        : kind === 'likert'
          ? await setLikertInteractionStatus(repoRoot, sessionId, {
              slideId,
              status: action === 'close' ? 'closed' : 'open',
              optionCount,
            })
          : await setPollInteractionStatus(repoRoot, sessionId, {
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
        broadcastBranch(repoRoot, sessionId, {
          slideId,
          onClose,
          onCloseTarget,
        });
      }
    }

    serveJson(res, 200, { ok: true, interactionState: agg });
    return true;
  }

  const feedbackExportMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/feedback\/([^/]+)\.(csv|json)$/
  );
  if (feedbackExportMatch && req.method === 'GET') {
    const sessionId = feedbackExportMatch[1];
    const slideId = feedbackExportMatch[2];
    const fmt = feedbackExportMatch[3];
    const s = await getPresentSession(repoRoot, sessionId);
    if (!s) return notFound(res);
    // Feedback entries are audience PII (free text + deviceId) → deck-write only.
    const pres = await requirePresentationControl({
      repoRoot,
      presentationId: s.presentationId,
      authedUser,
      res,
    });
    if (!pres) return true;
    const slide = findSlideById(pres, slideId);
    if (!slide) return badRequest(res, 'slide not found');
    if (liveInteractionKind(String(slide?.type || '')) !== 'feedback')
      return badRequest(res, 'slide is not a feedback slide');

    const entries = await listFeedbackEntries(repoRoot, sessionId, { slideId });
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

  const sessEnableMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/control\/enable$/
  );
  if (sessEnableMatch && req.method === 'POST') {
    const sessionId = sessEnableMatch[1];
    const s = await getPresentSession(repoRoot, sessionId);
    if (!s) return notFound(res);
    const pres = await requirePresentationControl({
      repoRoot,
      presentationId: s.presentationId,
      authedUser,
      res,
    });
    if (!pres) return true;
    const next = setPresentSessionControlEnabled(repoRoot, sessionId, true);
    serveJson(res, 200, next);
    return true;
  }

  const sessDisableMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/control\/disable$/
  );
  if (sessDisableMatch && req.method === 'POST') {
    const sessionId = sessDisableMatch[1];
    const s = await getPresentSession(repoRoot, sessionId);
    if (!s) return notFound(res);
    const pres = await requirePresentationControl({
      repoRoot,
      presentationId: s.presentationId,
      authedUser,
      res,
    });
    if (!pres) return true;
    const next = setPresentSessionControlEnabled(repoRoot, sessionId, false);
    serveJson(res, 200, next);
    return true;
  }

  const sessControlMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/control$/
  );
  if (sessControlMatch && req.method === 'POST') {
    const sessionId = sessControlMatch[1];
    const s = await getPresentSession(repoRoot, sessionId);
    if (!s) return notFound(res);
    const pres = await requirePresentationControl({
      repoRoot,
      presentationId: s.presentationId,
      authedUser,
      res,
    });
    if (!pres) return true;
    const parsed = await requireJsonBody(req, res);
    if (!parsed.ok) return true;
    const body = parsed.body;
    const result = await sendPresentSessionControlCommand(repoRoot, sessionId, body);
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

  return false;
}
