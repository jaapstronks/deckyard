import crypto from 'node:crypto';
import { parseCookies } from '../../../utils/cookies.js';
import { normalizeLang } from '../../../utils/translation-status.js';
import { isHttpsRequest } from '../../../utils/request-url.js';

export function pickPresentationForLang(pres, lang) {
  const l = normalizeLang(lang);
  if (
    l &&
    pres?.i18n?.versions &&
    typeof pres.i18n.versions === 'object' &&
    pres.i18n.versions?.[l]
  ) {
    const v = pres.i18n.versions[l];
    return {
      ...pres,
      title: typeof v?.title === 'string' ? v.title : pres.title,
      slides: Array.isArray(v?.slides) ? v.slides : pres.slides,
    };
  }
  return pres;
}

export function ensureQaDeviceCookie(req) {
  const NAME = 'sb_qa';
  const cookies = parseCookies(req.headers?.cookie);
  const existing = String(cookies[NAME] || '').trim();
  if (existing) return { id: existing, setCookie: null };
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
  // Keep it lightweight (not ironclad): stable per-device id via cookie.
  const maxAge = 60 * 60 * 24 * 90; // 90 days
  const parts = [
    `${NAME}=${encodeURIComponent(id)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  return { id, setCookie: parts.join('; ') };
}

export function ensureInteractionDeviceCookie(req) {
  const NAME = 'sb_int';
  const cookies = parseCookies(req.headers?.cookie);
  const existing = String(cookies[NAME] || '').trim();
  if (existing) return { id: existing, setCookie: null };
  const id =
    typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex');
  // Lightweight, privacy-light device id used only for session-scoped interactions.
  const maxAge = 60 * 60 * 24 * 90; // 90 days
  const parts = [
    `${NAME}=${encodeURIComponent(id)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (isHttpsRequest(req)) parts.push('Secure');
  return { id, setCookie: parts.join('; ') };
}

export function followMetaFromPresentation(pres, { includeTranslationStatus = false } = {}) {
  const dominant =
    typeof pres?.i18n?.dominant === 'string' ? pres.i18n.dominant : null;
  const versions =
    pres?.i18n?.versions && typeof pres.i18n.versions === 'object'
      ? pres.i18n.versions
      : {};
  const availableLangs = [];
  if (versions?.nl) availableLangs.push('nl');
  if (versions?.['en-GB']) availableLangs.push('en-GB');

  const result = {
    dominantLang: normalizeLang(dominant),
    availableLangs,
  };

  if (includeTranslationStatus) {
    const translation = pres?.i18n?.translation || {};
    const progress = pres?.i18n?.progress || {};
    result.translationStatus = {
      nl: {
        complete: versions?.nl && (progress?.missingEnGbToNl ?? 0) === 0,
        missing: progress?.missingEnGbToNl ?? null,
        jobStatus: translation?.nl?.status || null,
      },
      'en-GB': {
        complete: versions?.['en-GB'] && (progress?.missingNlToEnGb ?? 0) === 0,
        missing: progress?.missingNlToEnGb ?? null,
        jobStatus: translation?.['en-GB']?.status || null,
      },
    };
  }

  return result;
}

export function isQaEnabledForPresentation(pres) {
  // Back-compat: default to enabled unless explicitly disabled.
  const v = pres?.settings?.qaEnabled;
  return v !== false;
}

export function computeAudienceCapabilitiesFromState(state, pres) {
  const live = String(state?.status || '') === 'live';
  const slideType = String(state?.slideType || '');
  const interactionType =
    live &&
    (slideType === 'poll-slide' ||
      slideType === 'likert-slide' ||
      slideType === 'likert-slider-slide' ||
      slideType === 'feedback-slide')
      ? slideType === 'likert-slide' ||
        slideType === 'likert-slider-slide'
        ? 'likert'
        : slideType === 'feedback-slide'
          ? 'feedback'
        : 'poll'
      : null;
  const interaction = interactionType
    ? {
        type: interactionType,
        slideId: typeof state?.slideId === 'string' ? state.slideId : '',
        sessionId: typeof state?.sessionId === 'string' ? state.sessionId : '',
      }
    : null;
  const dominantInteraction = !!interaction;
  const qaEnabled = isQaEnabledForPresentation(pres);
  return {
    canViewSlide: live,
    canUseQa: live && !dominantInteraction && qaEnabled,
    canUseCaptions: false,
    canUseZoom: false,
    interaction: interaction || undefined,
  };
}

export function writeSseHeaders(res, extraHeaders = {}) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    ...extraHeaders,
  });
  res.write('\n');
}
