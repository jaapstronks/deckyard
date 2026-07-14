import { readAppSettings, readUserSettings } from '../storage/settings.js';
import { getRequestOrigin, toAbsoluteUrl } from './request-url.js';
import { nowIso } from './normalize.js';

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

async function postJson(url, payload, { timeoutMs = 4500, headers = {} } = {}) {
  const u = String(url || '').trim();
  if (!u) return { ok: false, status: 0, error: 'Missing URL' };

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const resp = await fetch(u, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'user-agent': 'presentation-system-webhook/1',
        ...headers,
      },
      body: JSON.stringify(payload || {}),
      signal: ac.signal,
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
    interaction: interaction && typeof interaction === 'object'
      ? {
          type: String(interaction.type || '').trim() || null,
          slideId: String(interaction.slideId || '').trim() || null,
          totals: Array.isArray(interaction.totals) ? interaction.totals : null,
          total: typeof interaction.total === 'number' ? interaction.total : null,
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
  req = null,
  extra = null,
} = {}) {
  const now = nowIso();
  const origin = getRequestOrigin(req);

  const presentationId = typeof pres?.id === 'string' ? pres.id : '';
  const editPath = presentationId ? `/app/${presentationId}` : null;
  const editUrl = editPath ? toAbsoluteUrl(origin, editPath) : null;

  const publishId =
    pres?.published && typeof pres.published === 'object'
      ? String(pres.published.id || '').trim()
      : '';
  const publishSlug =
    pres?.published && typeof pres.published === 'object'
      ? String(pres.published.slug || '').trim()
      : '';
  const publicPath =
    publishId && publishSlug ? `/p/${publishId}-${publishSlug}` : null;
  const publicUrl = publicPath ? toAbsoluteUrl(origin, publicPath) : null;

  const email = String(authedUser?.email || '').trim().toLowerCase();
  const name = pickDisplayName({ authedUser, userSettings });

  return {
    event: String(event || '').trim(),
    createdAt: now,
    actor: {
      // This app currently keys users by email; treat email as the stable id.
      id: email || null,
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
      scope: typeof pres?.scope === 'string' ? pres.scope : 'private',
      published:
        publishId && publishSlug
          ? {
              id: publishId,
              slug: publishSlug,
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
    ...(extra && typeof extra === 'object' ? { extra } : null),
  };
}

function buildSlideLibraryPayload({
  event = '',
  authedUser = null,
  userSettings = null,
  slideItem = null,
  req = null,
} = {}) {
  const now = nowIso();
  const origin = getRequestOrigin(req);

  const slideId = typeof slideItem?.id === 'string' ? slideItem.id : '';
  const libraryPath = '/app/slide-library';
  const libraryUrl = toAbsoluteUrl(origin, libraryPath);
  // Permalink to the specific slide (team library since that's where slides are added)
  const slidePath = slideId ? `/app/slide-library/team/${slideId}` : '';
  const slideUrl = slidePath ? toAbsoluteUrl(origin, slidePath) : null;

  const email = String(authedUser?.email || '').trim().toLowerCase();
  const name = pickDisplayName({ authedUser, userSettings });

  return {
    event: String(event || '').trim(),
    createdAt: now,
    actor: {
      id: email || null,
      email: email || null,
      name: name || null,
      role: authedUser?.isAdmin ? 'admin' : 'user',
    },
    slide: {
      id: slideId || null,
      name: typeof slideItem?.name === 'string' ? slideItem.name : '',
      description: typeof slideItem?.description === 'string' ? slideItem.description : '',
      slideType: typeof slideItem?.slideType === 'string' ? slideItem.slideType : '',
      themeId: typeof slideItem?.themeId === 'string' ? slideItem.themeId : '',
      previewUrl: typeof slideItem?.previewUrl === 'string' ? slideItem.previewUrl : null,
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

export async function maybeFireWebhook(
  repoRoot,
  req,
  { event = '', pres = null, slideItem = null, authedUser = null, extra = null } = {}
) {
  const e = String(event || '').trim();
  if (!e) return;
  if (!repoRoot) return;

  const settings = await readAppSettings(repoRoot);
  const wh =
    settings?.webhooks && typeof settings.webhooks === 'object'
      ? settings.webhooks
      : {};

  const url =
    e === 'presentation.moved_to_workspace'
      ? String(wh.presentationMovedToWorkspaceUrl || '').trim()
      : e === 'slide.added_to_team_library'
        ? String(wh.slideAddedToTeamLibraryUrl || '').trim()
        : e === 'presentation.published'
          ? String(wh.presentationPublishedUrl || '').trim()
          : e === 'comment.created'
            ? String(wh.commentCreatedUrl || '').trim()
            : '';
  if (!url) return;

  const email = String(authedUser?.email || '').trim();
  const userSettings = email ? await readUserSettings(repoRoot, email) : null;

  // Use different payload builder for slide library events
  const payload = e === 'slide.added_to_team_library'
    ? buildSlideLibraryPayload({
        event: e,
        authedUser,
        userSettings,
        slideItem,
        req,
      })
    : buildCommonPayload({
        event: e,
        authedUser,
        userSettings,
        pres,
        req,
        extra,
      });

  // Best-effort: never block the API response on webhook delivery.
  void postJson(url, payload, {
    headers: { 'x-sb-event': e },
  }).then((r) => {
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[webhook] failed event=${e} status=${r.status} url=${url} err=${r.error || ''}`.trim()
      );
    }
  });
}

/**
 * Fire webhook for lead submission.
 * @param {string} repoRoot - Repository root path
 * @param {Object} req - Request object (for origin)
 * @param {Object} data - Lead data
 * @param {Object} data.presentation - Presentation object
 * @param {string} data.slideId - Slide ID
 * @param {Object} data.lead - Lead object
 */
export async function maybeFireLeadWebhook(
  repoRoot,
  req,
  { presentation = null, slideId = '', lead = null } = {}
) {
  if (!repoRoot || !lead) return;

  const settings = await readAppSettings(repoRoot);
  const wh =
    settings?.webhooks && typeof settings.webhooks === 'object'
      ? settings.webhooks
      : {};

  const url = String(wh.leadSubmittedUrl || '').trim();
  if (!url) return;

  const origin = getRequestOrigin(req);
  const presentationId = presentation?.id || '';
  const editPath = presentationId ? `/app/${presentationId}` : null;
  const editUrl = editPath ? toAbsoluteUrl(origin, editPath) : null;

  const payload = {
    event: 'lead.submitted',
    createdAt: nowIso(),
    presentation: {
      id: presentationId || null,
      title: presentation?.title || '',
      editUrl,
    },
    slide: {
      id: String(slideId || '').trim() || null,
    },
    lead: {
      name: lead?.name || '',
      email: lead?.email || '',
      submittedAt: lead?.submittedAt || nowIso(),
    },
  };

  // Best-effort: never block the API response on webhook delivery.
  void postJson(url, payload, {
    headers: { 'x-sb-event': 'lead.submitted' },
  }).then((r) => {
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[webhook] failed event=lead.submitted status=${r.status} url=${url} err=${r.error || ''}`.trim()
      );
    }
  });
}

export async function maybeFireInteractionWebhook(
  repoRoot,
  { event = '', sessionId = '', interaction = null } = {}
) {
  const e = String(event || '').trim();
  if (!e) return;
  if (!repoRoot) return;

  const settings = await readAppSettings(repoRoot);
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
  void postJson(url, payload, {
    headers: { 'x-sb-event': e },
  }).then((r) => {
    if (!r.ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[webhook] failed event=${e} status=${r.status} url=${url} err=${r.error || ''}`.trim()
      );
    }
  });
}
