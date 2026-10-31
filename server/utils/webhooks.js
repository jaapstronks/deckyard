import { createHmac } from 'node:crypto';
import { getAppSettings, getUserSettings } from '../storage/settings.js';
import { toAbsoluteUrl } from './request-url.js';
import { nowIso } from './normalize.js';
import { assertPublicHttpUrl } from './ssrf-guard.js';
import { crossOrganizationScope } from '../storage/scope.js';
import { createLogger } from './logger.js';
import { fireAndForget } from './fire-and-forget.js';
import { normalizeEmail } from '../../shared/email.js';
import { latestPublicEditionsForDecks } from '../storage/editions.js';

const log = createLogger('webhook');

/** Outgoing user-agent for every webhook delivery (Deckyard-branded, B81). */
const WEBHOOK_USER_AGENT = 'Deckyard-Webhook/1';

/** Header carrying the opt-in HMAC signature, alongside `x-sb-event`. */
const SIGNATURE_HEADER = 'x-sb-signature';

/**
 * The webhook actor identity. Prefer the stable `users.id` carried by the async
 * auth path (the key every ownership decision keys on); fall back to null for
 * the shapes that have no id — file mode, external/legacy rows, the auth-off
 * operator. The email travels beside it as a display/contact value, no longer
 * as the identity (B81 — this was the last outward contract on email identity).
 * @param {{ id?: string } | null} authedUser
 * @returns {string|null}
 */
function resolveActorId(authedUser) {
  const id = authedUser?.id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/** Webhook config reads run outside any request: instance-level settings. */
function webhookSettingsScope(repoRoot) {
  return crossOrganizationScope(
    repoRoot ?? null,
    'webhook dispatch: config is instance-level',
  );
}

function pickDisplayName({ authedUser, userSettings }) {
  const profileName =
    userSettings?.profile &&
    typeof userSettings.profile === 'object' &&
    typeof userSettings.profile.name === 'string'
      ? String(userSettings.profile.name).trim()
      : '';
  if (profileName) return profileName;
  const authName = typeof authedUser?.name === 'string' ? authedUser.name : '';
  return String(authName || '').trim();
}

export async function postJson(
  url,
  payload,
  { timeoutMs = 4500, headers = {}, signingSecret = '' } = {},
) {
  const u = String(url || '').trim();
  if (!u) return { ok: false, status: 0, error: 'Missing URL' };

  // SSRF guard: webhook URLs are admin-configured, but a stale/compromised
  // setting must not let the server POST to loopback/private/metadata hosts.
  try {
    await assertPublicHttpUrl(u);
  } catch {
    return { ok: false, status: 0, error: 'Blocked non-public webhook URL' };
  }

  // Serialize once so the signature is computed over the exact bytes sent.
  const body = JSON.stringify(payload || {});
  const outHeaders = {
    'content-type': 'application/json; charset=utf-8',
    'user-agent': WEBHOOK_USER_AGENT,
    ...headers,
  };

  // Opt-in HMAC signing: when a shared secret is configured, sign the request
  // body with HMAC-SHA256 so a receiver can verify the POST came from this
  // instance. The signature rides in `x-sb-signature` alongside `x-sb-event`;
  // absent entirely when no secret is set.
  const secret = String(signingSecret || '');
  if (secret) {
    const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
    outHeaders[SIGNATURE_HEADER] = `sha256=${sig}`;
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(u, {
      method: 'POST',
      headers: outHeaders,
      body,
      signal: ac.signal,
      redirect: 'error', // don't follow a 30x into private space
    });
    return { ok: resp.ok, status: resp.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e?.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function buildInteractionPayload({
  event = '',
  sessionId = '',
  interaction = null,
} = {}) {
  const now = nowIso();
  return {
    event: String(event || '').trim(),
    timestamp: now,
    session: {
      id: String(sessionId || '').trim() || null,
    },
    interaction:
      interaction && typeof interaction === 'object'
        ? {
            type: String(interaction.type || '').trim() || null,
            slideId: String(interaction.slideId || '').trim() || null,
            totals: Array.isArray(interaction.totals)
              ? interaction.totals
              : null,
            total:
              typeof interaction.total === 'number' ? interaction.total : null,
            status: String(interaction.status || '').trim() || null,
          }
        : null,
  };
}

function buildCommonPayload({
  event = '',
  authedUser = null,
  userSettings = null,
  pres = null,
  edition = null,
  origin = null,
  extra = null,
} = {}) {
  const now = nowIso();

  const presentationId = typeof pres?.id === 'string' ? pres.id : '';
  const editPath = presentationId ? `/app/${presentationId}` : null;
  const editUrl = editPath ? toAbsoluteUrl(origin, editPath) : null;

  // The deck's newest public edition (`server/storage/editions.js`), if any.
  const published =
    pres?.published && typeof pres.published === 'object'
      ? pres.published
      : null;
  const publicPath = published?.path || null;
  const publicUrl = publicPath ? toAbsoluteUrl(origin, publicPath) : null;

  const email = normalizeEmail(authedUser?.email);
  const name = pickDisplayName({ authedUser, userSettings });

  return {
    event: String(event || '').trim(),
    createdAt: now,
    actor: {
      id: resolveActorId(authedUser),
      email: email || null,
      name: name || null,
      role: authedUser?.isAdmin ? 'admin' : 'user',
    },
    presentation: {
      id: presentationId || null,
      title: typeof pres?.title === 'string' ? pres.title : '',
      description:
        typeof pres?.description === 'string' ? pres.description : '',
      theme: typeof pres?.theme === 'string' ? pres.theme : '',
      visibility:
        typeof pres?.visibility === 'string' ? pres.visibility : 'private',
      published: published
        ? {
            publicationId: published.publicationId,
            version: published.version,
            path: publicPath,
            url: publicUrl,
          }
        : null,
    },
    links: {
      editPath,
      editUrl,
      publicPath,
      publicUrl,
    },
    ...(edition ? { edition: editionPayload(edition, origin) } : null),
    ...(extra && typeof extra === 'object' ? { extra } : null),
  };
}

/**
 * The edition a `presentation.published` event announces. Its `id` is the
 * same on every delivery of that edition, so a receiver can tell a repeat
 * from a new publication.
 */
function editionPayload(edition, origin) {
  const path = edition.path || null;
  return {
    id: edition.id,
    publicationId: edition.publicationId,
    version: edition.version,
    manifestHash: edition.manifestHash,
    publishedAt: edition.publishedAt,
    path,
    url: path ? toAbsoluteUrl(origin, path) : null,
  };
}

function buildSlideLibraryPayload({
  event = '',
  authedUser = null,
  userSettings = null,
  slideItem = null,
  origin = null,
} = {}) {
  const now = nowIso();

  const slideId = typeof slideItem?.id === 'string' ? slideItem.id : '';
  const libraryPath = '/app/slide-library';
  const libraryUrl = toAbsoluteUrl(origin, libraryPath);
  // Permalink to the specific slide (organization shelf since that's where shared slides live)
  const slidePath = slideId ? `/app/slide-library/organization/${slideId}` : '';
  const slideUrl = slidePath ? toAbsoluteUrl(origin, slidePath) : null;

  const email = normalizeEmail(authedUser?.email);
  const name = pickDisplayName({ authedUser, userSettings });

  return {
    event: String(event || '').trim(),
    createdAt: now,
    actor: {
      id: resolveActorId(authedUser),
      email: email || null,
      name: name || null,
      role: authedUser?.isAdmin ? 'admin' : 'user',
    },
    slide: {
      id: slideId || null,
      name: typeof slideItem?.name === 'string' ? slideItem.name : '',
      description:
        typeof slideItem?.description === 'string' ? slideItem.description : '',
      slideType:
        typeof slideItem?.slideType === 'string' ? slideItem.slideType : '',
      themeId: typeof slideItem?.themeId === 'string' ? slideItem.themeId : '',
      previewUrl:
        typeof slideItem?.previewUrl === 'string' ? slideItem.previewUrl : null,
      url: slideUrl,
    },
    links: {
      libraryPath,
      libraryUrl,
      slidePath: slidePath || null,
      slideUrl,
    },
  };
}

/**
 * The deck with its publication state, read from its editions when the caller
 * did not already attach it: a stored deck carries no copy of it.
 */
async function withPublication(repoRoot, pres) {
  if (pres.published !== undefined || !pres.id) return pres;
  const published = await latestPublicEditionsForDecks(
    crossOrganizationScope(repoRoot, 'webhook: the deck the event names'),
    [pres.id],
  );
  return { ...pres, published: published.get(pres.id) || null };
}

/**
 * Fire the configured webhook for an event, if one is set. Best-effort: never
 * blocks the caller on delivery.
 *
 * `origin` is the absolute base the payload's links are built on: a route
 * passes the request's (`getRequestOrigin(req)`), a service with no request
 * the configured public base (`getAppBaseUrl()`). `null` leaves the absolute
 * URLs out and keeps the paths.
 *
 * @param {string|null} repoRoot
 * @param {string|null} origin - e.g. `https://decks.example.com`
 * @param {Object} [event] - `edition` names the edition a
 *   `presentation.published` event announces
 * @returns {Promise<void>}
 */
export async function maybeFireWebhook(
  repoRoot,
  origin,
  {
    event = '',
    pres = null,
    slideItem = null,
    authedUser = null,
    edition = null,
    extra = null,
  } = {},
) {
  const e = String(event || '').trim();
  if (!e) return;
  if (!repoRoot) return;

  const settings = await getAppSettings(webhookSettingsScope(repoRoot));
  const wh =
    settings?.webhooks && typeof settings.webhooks === 'object'
      ? settings.webhooks
      : {};

  const url =
    e === 'presentation.moved_to_organization'
      ? String(wh.presentationMovedToOrganizationUrl || '').trim()
      : e === 'slide.added_to_organization_library'
        ? String(wh.slideAddedToOrganizationLibraryUrl || '').trim()
        : e === 'presentation.published'
          ? String(wh.presentationPublishedUrl || '').trim()
          : e === 'comment.created'
            ? String(wh.commentCreatedUrl || '').trim()
            : '';
  if (!url) return;

  const email = String(authedUser?.email || '').trim();
  const userSettings = email
    ? await getUserSettings(webhookSettingsScope(repoRoot), email)
    : null;

  // Use different payload builder for slide library events
  const payload =
    e === 'slide.added_to_organization_library'
      ? buildSlideLibraryPayload({
          event: e,
          authedUser,
          userSettings,
          slideItem,
          origin,
        })
      : buildCommonPayload({
          event: e,
          authedUser,
          userSettings,
          pres: pres ? await withPublication(repoRoot, pres) : null,
          edition,
          origin,
          extra,
        });

  // Best-effort: never block the API response on webhook delivery.
  fireAndForget(
    postJson(url, payload, {
      headers: { 'x-sb-event': e },
      signingSecret: String(wh.signingSecret || ''),
    }).then((r) => {
      if (!r.ok) {
        log.warn(
          `failed event=${e} status=${r.status} url=${url} err=${r.error || ''}`.trim(),
        );
      }
    }),
    'webhook POST',
  );
}

export async function maybeFireInteractionWebhook(
  repoRoot,
  { event = '', sessionId = '', interaction = null } = {},
) {
  const e = String(event || '').trim();
  if (!e) return;
  if (!repoRoot) return;

  const settings = await getAppSettings(webhookSettingsScope(repoRoot));
  const wh =
    settings?.webhooks && typeof settings.webhooks === 'object'
      ? settings.webhooks
      : {};

  const url =
    e === 'interaction.poll_closed'
      ? String(wh.interactionPollClosedUrl || '').trim()
      : e === 'interaction.feedback_submitted'
        ? String(wh.interactionFeedbackSubmittedUrl || '').trim()
        : e === 'interaction.likert_closed'
          ? String(wh.interactionLikertClosedUrl || '').trim()
          : '';
  if (!url) return;

  const payload = buildInteractionPayload({
    event: e,
    sessionId,
    interaction,
  });

  // Best-effort: never block the API response on webhook delivery.
  fireAndForget(
    postJson(url, payload, {
      headers: { 'x-sb-event': e },
      signingSecret: String(wh.signingSecret || ''),
    }).then((r) => {
      if (!r.ok) {
        log.warn(
          `failed event=${e} status=${r.status} url=${url} err=${r.error || ''}`.trim(),
        );
      }
    }),
    'webhook POST',
  );
}
