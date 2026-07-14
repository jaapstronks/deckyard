import {
  attachSessionSseClient,
  broadcastBranch,
  createPresentSession,
  getPresentSession,
  sendPresentSessionControlCommand,
  setPresentSessionControlEnabled,
  updatePresentSessionState,
} from '../../storage/present-sessions.js';
import { getPresentation } from '../../storage/presentations.js';
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
  json,
  methodNotAllowed,
  notFound,
  serveJson,
  unauthorized,
} from '../../utils/http.js';
import {
  isInteractiveSlideType,
  findSlideById,
  getOptionCountForSlide,
  pollOptionCountFromSlide,
  likertOptionCountFromSlide,
  likertSliderOptionCountFromSlide,
} from '../../utils/interaction-helpers.js';

function csvEscapeCell(v) {
  const s = String(v ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r'))
    return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function handlePresentSessions({ repoRoot, req, res, url }) {
  if (url.pathname === '/api/present-sessions' && req.method === 'POST') {
    const body = await json(req);
    const presentationId =
      typeof body?.presentationId === 'string' ? body.presentationId : '';
    if (!presentationId.trim())
      return badRequest(res, 'Expected { presentationId: string }');
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
    if (req.method === 'GET') {
      serveJson(res, 200, {
        sessionId,
        presentationId: s.presentationId,
        slideId: s.state?.slideId || '',
        slideIndex: Number(s.state?.slideIndex || 0) || 0,
        stepIdx: Math.max(0, Number(s.state?.stepIdx || 0) || 0),
        stepParagraphs: !!s.state?.stepParagraphs,
        updatedAt: Number(s.state?.updatedAt || 0) || 0,
        controlEnabled: !!s.controlEnabled,
      });
      return true;
    }
    if (req.method === 'POST') {
      const body = await json(req);
      const presentationId =
        typeof body?.presentationId === 'string' ? body.presentationId : '';
      if (!presentationId.trim() || presentationId.trim() !== s.presentationId)
        return badRequest(res, 'presentationId mismatch');
      const slideId = typeof body?.slideId === 'string' ? body.slideId : '';
      const slideType =
        typeof body?.slideType === 'string' ? body.slideType : '';
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

      // If this is an interactive slide, eagerly ensure interaction state exists so the
      // presenter can show live results immediately (even before the first vote).
      try {
        if (isInteractiveSlideType(slideType) && slideId) {
          const pres = await getPresentation(repoRoot, presentationId);
          const slide = pres ? findSlideById(pres, slideId) : null;
          if (slideType === 'feedback-slide') {
            await ensureFeedbackForSlide(repoRoot, sessionId, {
              presentationId,
              slideId,
            });
          } else {
            const optionCount = getOptionCountForSlide(slideType, slide);
            if (optionCount > 0) {
              if (slideType === 'likert-slide' || slideType === 'likert-slider-slide') {
                await ensureLikertInteractionForSlide(repoRoot, sessionId, {
                  presentationId,
                  slideId,
                  optionCount,
                });
              } else {
                await ensurePollInteractionForSlide(repoRoot, sessionId, {
                  presentationId,
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
    const pres = await getPresentation(repoRoot, s.presentationId);
    if (!pres) return badRequest(res, 'presentation not found');
    const slide = findSlideById(pres, slideId);
    if (!slide) return badRequest(res, 'slide not found');
    const slideType = String(slide?.type || '');
    if (
      slideType !== 'poll-slide' &&
      slideType !== 'likert-slide' &&
      slideType !== 'likert-slider-slide' &&
      slideType !== 'feedback-slide'
    )
      return badRequest(res, 'slide is not interactive');
    const optionCount =
      slideType === 'feedback-slide'
        ? 0
        : slideType === 'likert-slide'
          ? likertOptionCountFromSlide(slide)
          : slideType === 'likert-slider-slide'
            ? likertSliderOptionCountFromSlide(slide)
          : pollOptionCountFromSlide(slide);
    if (slideType !== 'feedback-slide' && !optionCount)
      return badRequest(
        res,
        slideType === 'likert-slide' || slideType === 'likert-slider-slide'
          ? 'likert has no options'
          : 'poll has no options'
      );

    // Ensure interaction exists first.
    if (slideType === 'feedback-slide') {
      await ensureFeedbackForSlide(repoRoot, sessionId, {
        presentationId: s.presentationId,
        slideId,
      });
    } else if (
      slideType === 'likert-slide' ||
      slideType === 'likert-slider-slide'
    ) {
      await ensureLikertInteractionForSlide(repoRoot, sessionId, {
        presentationId: s.presentationId,
        slideId,
        optionCount,
      });
    } else {
      await ensurePollInteractionForSlide(repoRoot, sessionId, {
        presentationId: s.presentationId,
        slideId,
        optionCount,
      });
    }

    if (action === 'reset') {
      const agg =
        slideType === 'feedback-slide'
          ? await resetFeedback(repoRoot, sessionId, { slideId })
          : slideType === 'likert-slide' || slideType === 'likert-slider-slide'
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
      slideType === 'feedback-slide'
        ? await setFeedbackStatus(repoRoot, sessionId, {
            slideId,
            status: action === 'close' ? 'closed' : 'open',
          })
        : slideType === 'likert-slide' || slideType === 'likert-slider-slide'
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
    if (action === 'close' && slideType !== 'feedback-slide') {
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
    const pres = await getPresentation(repoRoot, s.presentationId);
    if (!pres) return badRequest(res, 'presentation not found');
    const slide = findSlideById(pres, slideId);
    if (!slide) return badRequest(res, 'slide not found');
    if (String(slide?.type || '') !== 'feedback-slide')
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

  const sessEventsMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/events$/
  );
  if (sessEventsMatch && req.method === 'GET') {
    const sessionId = sessEventsMatch[1];
    const s = await getPresentSession(repoRoot, sessionId);
    if (!s) return notFound(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('\n');
    await attachSessionSseClient(repoRoot, sessionId, res);
    return true;
  }

  const sessEnableMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/control\/enable$/
  );
  if (sessEnableMatch && req.method === 'POST') {
    const sessionId = sessEnableMatch[1];
    const s = await getPresentSession(repoRoot, sessionId);
    if (!s) return notFound(res);
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
    const body = await json(req);
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
