/**
 * Capability-based present-session routes: **the session id is the authorization**.
 *
 * A present-session id is a UUID minted behind deck-write (`POST
 * /api/present-sessions`) and handed out as a QR/join link with a 24-hour idle
 * TTL. Whoever holds that link is, by the deck owner's own act, allowed to
 * follow the session and work its speaker notes — logged in or not. These
 * routes therefore sit in the *public* block of the API dispatcher, before the
 * login gate, exactly like the follow-along audience routes next door
 * (`routes/api/follow/*`, where the live follow code plays the same part).
 *
 * The scope is strictly the one session: every handler resolves the session
 * first and then acts only on `session.presentationId`. Nothing here accepts a
 * presentation id from the caller, so a token for session A can never address
 * deck B.
 *
 * Presenter actions — pushing live state, opening/closing interactions,
 * exporting feedback, remote control — stay in `present-sessions.js` behind
 * deck-write. This module holds only what the audience/companion needs.
 *
 * @module server/routes/api/present-session-audience
 */

import {
  attachSessionSseClient,
  getPresentSession,
} from '../../storage/present-sessions/index.js';
import { getPresentation } from '../../storage/presentations/index.js';
import { updateSlideNotes } from '../../storage/presentations/slide-notes.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import {
  badRequest,
  json,
  methodNotAllowed,
  notFound,
  rateLimited,
  serveJson,
} from '../../utils/http.js';
import { errorToResponse } from '../../utils/errors.js';
import { allowCompanionNotesWrite, getClientIp } from '../../utils/rate-limit.js';
import { guardSseConnection } from '../../utils/sse-limiter.js';

/**
 * Why a companion read may skip the organization filter: the session id it came
 * in with is globally unique and already resolved to this exact deck.
 */
const COMPANION_READ_REASON =
  'notes companion: the present-session id is the authorization';

/**
 * Upper bound on one slide's notes from the companion. Well above any real
 * speaker note, well below the deck-size limit — so an oversized paste gets a
 * precise 400 here instead of a whole-deck limit error from storage.
 */
export const MAX_NOTES_LENGTH = 20000;

/**
 * Resolve a session and the deck it presents.
 *
 * A session that is unknown *or* past its TTL answers the same `null`: telling
 * the two apart would let a caller probe which session ids ever existed, and
 * the existing `/state` and `/events` routes already collapse both to a 404.
 *
 * @param {string} repoRoot
 * @param {string} sessionId
 * @returns {Promise<{session: Object, pres: Object}|null>}
 */
async function resolveSessionDeck(repoRoot, sessionId) {
  const session = await getPresentSession(repoRoot, sessionId);
  if (!session?.presentationId) return null;
  const pres = await getPresentation(
    crossOrganizationScope(repoRoot, COMPANION_READ_REASON),
    session.presentationId
  );
  if (!pres) return null;
  return { session, pres };
}

/**
 * GET /api/present-sessions/:sessionId/state
 *
 * The presenter's current position. Read-only and capability-based; the POST
 * counterpart (pushing state) is a presenter action and lives behind deck-write
 * in `present-sessions.js`.
 */
async function handleSessionState({ repoRoot, res }, sessionId) {
  const s = await getPresentSession(repoRoot, sessionId);
  if (!s) return notFound(res);
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

/**
 * GET /api/present-sessions/:sessionId/events
 *
 * The session's SSE stream (state, controlEnabled, deckUpdated, branch).
 */
async function handleSessionEvents({ repoRoot, req, res }, sessionId) {
  const s = await getPresentSession(repoRoot, sessionId);
  if (!s) return notFound(res);
  // Cap unauthenticated, long-lived streams before opening one (DoS guard).
  if (!guardSseConnection(req, res)) return true;
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

/**
 * GET /api/present-sessions/:sessionId/deck
 *
 * The deck behind this session, for the companion: slides (notes included),
 * title and theme id. Built to the follow-questions pattern — resolve the
 * capability, then read the deck cross-organization, because the token has
 * already answered the organization question.
 *
 * Deliberately narrower than `GET /api/presentations/:id`: no owner, no
 * collaborators, no settings, no version history. A join link is not a login.
 */
async function handleSessionDeck({ repoRoot, res }, sessionId) {
  const resolved = await resolveSessionDeck(repoRoot, sessionId);
  if (!resolved) return notFound(res);
  const { session, pres } = resolved;
  serveJson(res, 200, {
    sessionId,
    // `id` as well as `presentationId`: the companion hands this object to the
    // shared slide renderer and the Q&A controller, which both address the deck
    // by `id` exactly as they do for a deck fetched the authenticated way.
    id: pres.id,
    presentationId: pres.id,
    title: typeof pres.title === 'string' ? pres.title : '',
    theme: pres.theme || '',
    lang: pres.lang || '',
    revision: Number(pres.revision) || 0,
    slides: Array.isArray(pres.slides) ? pres.slides : [],
    controlEnabled: !!session.controlEnabled,
  });
  return true;
}

/**
 * PUT /api/present-sessions/:sessionId/notes/:slideId
 * Body: `{ notes: string }`
 *
 * Authorization is the session and nothing else: it must exist and be within
 * its TTL, and the write lands on `session.presentationId` — never on an id the
 * caller named. A live session is *not* required; a speaker updates notes
 * before the talk starts as readily as during it, and the TTL is the boundary
 * the deck owner already agreed to when they minted the link.
 *
 * The write goes through `updateSlideNotes`, which replaces exactly this one
 * field and inherits the shared slide-lock policy (423) and the `deckUpdated`
 * broadcast that refreshes the editor and any other companion.
 */
async function handleSessionNotesWrite({ repoRoot, req, res }, sessionId, slideId) {
  // Anonymous write path: throttle per IP so a leaked join link cannot be used
  // to hammer the deck's slides column.
  const ip = getClientIp(req);
  if (!(await allowCompanionNotesWrite({ ip })))
    return rateLimited(res, 5, 'Too many notes updates, slow down');

  const resolved = await resolveSessionDeck(repoRoot, sessionId);
  if (!resolved) return notFound(res);
  const { pres } = resolved;

  const body = await json(req);
  if (typeof body?.notes !== 'string')
    return badRequest(res, 'Expected { notes: string }');
  if (body.notes.length > MAX_NOTES_LENGTH)
    return badRequest(res, `Notes must be ${MAX_NOTES_LENGTH} characters or less`);

  // A write must state its organization (see storage/scope.js). The deck the
  // token addressed is the one that answers it — resolved from the deck itself,
  // not guessed from a default.
  const writeScope = {
    repoRoot,
    organizationId: pres.organizationId,
    actorEmail: null,
  };

  let result;
  try {
    result = await updateSlideNotes(writeScope, pres, {
      slideId,
      notes: body.notes,
    });
  } catch (e) {
    // A locked slide is the refusal the companion can act on: somebody is
    // editing that slide right now, or the author pinned it. LockedError (423)
    // carries a statusCode, so emit it through the canonical error envelope
    // instead of a hand-rolled body. Unexpected errors propagate.
    if (e?.statusCode) return serveJson(res, e.statusCode, errorToResponse(e));
    throw e;
  }

  if (!result.ok) {
    if (result.reason === 'slide_not_found') return notFound(res, 'Slide not found');
    return badRequest(res, result.reason);
  }

  serveJson(res, 200, {
    ok: true,
    sessionId,
    presentationId: pres.id,
    slideId: result.slideId,
    notes: result.notes,
    revision: result.revision,
  });
  return true;
}

/**
 * Dispatch the capability-based present-session routes. Registered in the
 * public block of `routes/api/index.js`, before the login gate.
 *
 * @param {{repoRoot: string, req: Object, res: Object, url: URL}} ctx
 * @returns {Promise<boolean>} Whether a route handled the request.
 */
export async function handlePresentSessionsPublic({ repoRoot, req, res, url }) {
  const stateMatch = url.pathname.match(/^\/api\/present-sessions\/([^/]+)\/state$/);
  if (stateMatch && req.method === 'GET')
    return handleSessionState({ repoRoot, req, res }, stateMatch[1]);

  const eventsMatch = url.pathname.match(/^\/api\/present-sessions\/([^/]+)\/events$/);
  if (eventsMatch && req.method === 'GET')
    return handleSessionEvents({ repoRoot, req, res }, eventsMatch[1]);

  const deckMatch = url.pathname.match(/^\/api\/present-sessions\/([^/]+)\/deck$/);
  if (deckMatch) {
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
    return handleSessionDeck({ repoRoot, req, res }, deckMatch[1]);
  }

  const notesMatch = url.pathname.match(
    /^\/api\/present-sessions\/([^/]+)\/notes\/([^/]+)$/
  );
  if (notesMatch) {
    if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);
    return handleSessionNotesWrite(
      { repoRoot, req, res },
      notesMatch[1],
      decodeURIComponent(notesMatch[2])
    );
  }

  return false;
}
