/**
 * Capability-based live-session routes: **the session id is the authorization**.
 *
 * A live-session id is a UUID minted behind deck-write (`POST
 * /api/live-sessions`) and handed out as a QR/join link with a 24-hour idle
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
 * exporting feedback, remote control — stay in `live-sessions.js` behind
 * deck-write. This module holds only what the audience/companion needs.
 *
 * @module server/routes/api/live-session-audience
 */

import {
  attachSessionSseClient,
  getLiveSession,
} from '../../storage/live-sessions/index.js';
import { getPresentation } from '../../storage/presentations/index.js';
import { updateSlideNotes } from '../../storage/presentations/slide-notes.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import {
  badRequest,
  methodNotAllowed,
  notFound,
  rateLimited,
  serveJson,
  requireJsonBody,
} from '../../utils/http.js';
import { errorToResponse } from '../../utils/errors.js';
import { dispatchRoutes } from '../../utils/router.js';
import { getOptionalString } from '../../utils/request-validators.js';
import { allowCompanionNotesWrite, getClientIp } from '../../utils/rate-limit.js';
import { openSseStream } from '../../utils/sse.js';
import { resolveDeckLang } from '../../../shared/i18n-utils.js';

/**
 * Why a companion read may skip the organization filter: the session id it came
 * in with is globally unique and already resolved to this exact deck.
 */
const COMPANION_READ_REASON =
  'notes companion: the live-session id is the authorization';

/** The scope every capability-based read in this module acts under. */
function companionScope(repoRoot) {
  return crossOrganizationScope(repoRoot, COMPANION_READ_REASON);
}

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
  const session = await getLiveSession(companionScope(repoRoot), sessionId);
  if (!session?.presentationId) return null;
  const pres = await getPresentation(
    companionScope(repoRoot),
    session.presentationId
  );
  if (!pres) return null;
  return { session, pres };
}

/**
 * GET /api/live-sessions/:sessionId/state
 *
 * The presenter's current position. Read-only and capability-based; the POST
 * counterpart (pushing state) is a presenter action and lives behind deck-write
 * in `live-sessions.js`.
 */
async function handleSessionState({ repoRoot, res }, sessionId) {
  const s = await getLiveSession(companionScope(repoRoot), sessionId);
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
 * GET /api/live-sessions/:sessionId/events
 *
 * The session's SSE stream (state, controlEnabled, deckUpdated, branch).
 */
async function handleSessionEvents({ repoRoot, req, res }, sessionId) {
  const s = await getLiveSession(companionScope(repoRoot), sessionId);
  if (!s) return notFound(res);
  // openSseStream applies the connection guard (429 before stream headers).
  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  await attachSessionSseClient(companionScope(repoRoot), sessionId, res);
  return true;
}

/**
 * GET /api/live-sessions/:sessionId/deck
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
    // The one canonical answer to "what language is this deck" — i18n.active
    // before dominant before pres.lang (see shared/i18n-utils.js). The payload
    // carries the resolved value so the companion never re-derives it from a
    // deck object that deliberately omits the i18n block.
    lang: resolveDeckLang(pres) || '',
    revision: Number(pres.revision) || 0,
    slides: Array.isArray(pres.slides) ? pres.slides : [],
    controlEnabled: !!session.controlEnabled,
  });
  return true;
}

/**
 * PUT /api/live-sessions/:sessionId/notes/:slideId
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
async function handleSessionNotesWrite({ repoRoot, req, res }, sessionId, rawSlideId) {
  const slideId = decodeURIComponent(rawSlideId);
  // Anonymous write path: throttle per IP so a leaked join link cannot be used
  // to hammer the deck's slides column.
  const ip = getClientIp(req);
  if (!(await allowCompanionNotesWrite({ ip })))
    return rateLimited(res, 5, 'Too many notes updates, slow down');

  const resolved = await resolveSessionDeck(repoRoot, sessionId);
  if (!resolved) return notFound(res);
  const { pres } = resolved;

  const parsed = await requireJsonBody(req, res);
  if (!parsed.ok) return true;
  const body = parsed.body;
  const notes = getOptionalString(body, 'notes');
  if (notes === null)
    return badRequest(res, 'Expected { notes: string }');
  if (notes.length > MAX_NOTES_LENGTH)
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
      notes,
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
 * Declarative route table for the capability-based live-session routes
 * (A7.19 C8). Order matches the previous chain. `/state` and `/events` fall
 * through on a method mismatch (Form A) **on purpose**: their POST
 * counterparts are presenter actions that live behind deck-write in
 * `live-sessions.js`, mounted after the login gate — a 405 here would shadow
 * them. `/deck` and `/notes/:slideId` sent an explicit 405, preserved as
 * trailing catch-all rows.
 *
 * @type {import('../../utils/router.js').Route[]}
 */
export const ROUTES = [
  { method: 'GET', pattern: /^\/api\/live-sessions\/([^/]+)\/state$/, handler: handleSessionState },
  { method: 'GET', pattern: /^\/api\/live-sessions\/([^/]+)\/events$/, handler: handleSessionEvents },
  { method: 'GET', pattern: /^\/api\/live-sessions\/([^/]+)\/deck$/, handler: handleSessionDeck },
  { pattern: /^\/api\/live-sessions\/([^/]+)\/deck$/, handler: ({ res }) => methodNotAllowed(res, ['GET']) },
  { method: 'PUT', pattern: /^\/api\/live-sessions\/([^/]+)\/notes\/([^/]+)$/, handler: handleSessionNotesWrite },
  { pattern: /^\/api\/live-sessions\/([^/]+)\/notes\/([^/]+)$/, handler: ({ res }) => methodNotAllowed(res, ['PUT']) },
];

/**
 * Dispatch the capability-based live-session routes. Registered in the
 * public block of `routes/api/index.js`, before the login gate.
 *
 * @param {import('../../utils/context.js').PublicContext} ctx
 * @returns {Promise<boolean>|boolean} Whether a route handled the request.
 */
export function handleLiveSessionsPublic(ctx) {
  return dispatchRoutes(ROUTES, ctx);
}
