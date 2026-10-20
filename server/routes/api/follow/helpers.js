import crypto from 'node:crypto';
import { parseCookies } from '../../../utils/cookies.js';
import {
  normalizeLang,
  translationSourceFor,
} from '../../../../shared/i18n-utils.js';
import {
  existingVersionLangs,
  computeMissingTranslation,
  pickVersion,
  translationProgress,
} from '../../../../shared/i18n-progress.js';
import { isHttpsRequest } from '../../../utils/request-url.js';
import { crossOrganizationScope } from '../../../storage/scope.js';
import { liveInteractionKind } from '../../../../shared/slide-types/runtime.js';
import { projectPresentationForAudience } from '../../../utils/public-output.js';
import { buildMergedSlideTypes } from '../../../utils/custom-slide-type-runtime.js';

/**
 * The storage scope the follow-along audience reads under.
 *
 * These routes are sessionless by design — an audience member scans a QR code
 * and never authenticates — so there is no organization to state. The live
 * follow code resolved the presentation id, which makes it the authorization
 * (see server/storage/scope.js). Read-only, as a cross-organization scope must
 * be.
 *
 * @param {string|null} repoRoot
 * @returns {import('../../../storage/scope.js').StorageScope}
 */
export function followAudienceScope(repoRoot) {
  return crossOrganizationScope(
    repoRoot,
    'follow-along audience: the live follow code is the authorization',
  );
}

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

/** The one slide list every public follow read and render must use. */
export function followAudiencePresentation(pres, lang, slideTypes) {
  const requested = normalizeLang(lang);
  let unavailable = false;
  if (requested) {
    const version = pres?.i18n?.versions?.[requested];
    const sourceLang = translationSourceFor(pres, requested);
    const missing =
      version && sourceLang
        ? computeMissingTranslation({
            source: pickVersion(pres, sourceLang),
            target: pickVersion(pres, requested),
          }).missingCount
        : null;
    if (!version || (typeof missing === 'number' && missing > 0)) {
      unavailable = true;
    }
  }
  const projected = projectPresentationForAudience(
    pickPresentationForLang(pres, lang),
    {
      audience: 'reader',
      channel: 'follow',
      slideTypes,
    },
  );
  return unavailable ? { ...projected, slides: [] } : projected;
}

/** Load the deck's registry so positional links pin before projection. */
export async function loadFollowAudience(repoRoot, pres, lang) {
  const slideTypes = await buildMergedSlideTypes({
    repoRoot,
    organizationId: pres.organizationId,
  });
  return followAudiencePresentation(pres, lang, slideTypes);
}

/** Resolve legacy index state before filtering, then locate its stable id. */
export function followAudienceState(state, original, projected) {
  if (state?.status !== 'live') {
    return {
      ...state,
      slideId: '',
      slideIndex: -1,
      slideType: '',
      stepIdx: 0,
      stepParagraphs: false,
    };
  }
  const source = Array.isArray(original?.slides) ? original.slides : [];
  const visible = Array.isArray(projected?.slides) ? projected.slides : [];
  const explicitId = String(state.slideId || '').trim();
  const id = explicitId || source[state.slideIndex]?.id || '';
  const index = id ? visible.findIndex((slide) => slide?.id === id) : -1;
  if (index < 0) {
    return {
      ...state,
      slideId: '',
      slideIndex: -1,
      slideType: '',
      stepIdx: 0,
      stepParagraphs: false,
    };
  }
  return {
    ...state,
    slideId: id,
    slideIndex: index,
    slideType: visible[index].type || '',
  };
}

/** Explicit public state contract. Internal selection retains the bearer capability. */
export function followWireState(state) {
  return {
    status: state?.status,
    presentationId: state?.presentationId,
    slideId: state?.slideId || '',
    slideIndex: state?.slideIndex ?? -1,
    slideType: state?.slideType || '',
    stepIdx: state?.stepIdx || 0,
    stepParagraphs: !!state?.stepParagraphs,
    updatedAt: state?.updatedAt || 0,
  };
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

/**
 * What the follow-along audience is told about a deck's languages.
 *
 * `availableLangs` is every version the deck actually has, and
 * `translationStatus` has one entry per those versions — not a fixed NL/EN
 * pair. It used to be exactly that pair, read off the stored `i18n.progress`
 * counters: a deck with a German version advertised no German, and the
 * language buttons could not offer what the viewer route would happily serve.
 * The counters are derived now (`translationProgress`, D72).
 *
 * The dominant version is the translation source, so it is complete by
 * definition and reported as such.
 *
 * @param {Object} pres - a presentation
 * @param {Object} [opts]
 * @param {boolean} [opts.includeTranslationStatus] - add the per-version status
 * @returns {{dominantLang: string|null, availableLangs: string[],
 *   translationStatus?: Record<string, {complete: boolean, missing: number|null,
 *   jobStatus: string|null}>}}
 */
export function followMetaFromPresentation(
  pres,
  { includeTranslationStatus = false } = {},
) {
  const availableLangs = existingVersionLangs(pres);

  const result = {
    dominantLang: normalizeLang(pres?.i18n?.dominant),
    availableLangs,
  };

  if (includeTranslationStatus) {
    const translation =
      pres?.i18n?.translation && typeof pres.i18n.translation === 'object'
        ? pres.i18n.translation
        : {};
    const { dominant, missing } = translationProgress(pres);
    const status = {};
    for (const lang of availableLangs) {
      const count = lang === dominant ? 0 : missing[lang];
      status[lang] = {
        complete: count === 0,
        missing: typeof count === 'number' ? count : null,
        jobStatus: translation?.[lang]?.status || null,
      };
    }
    result.translationStatus = status;
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
  // What the audience may do here is the slide type's declared capability, not
  // a list of names this module keeps: `runtime: 'live'` plus the interaction
  // kind it collects. See shared/slide-types/runtime.js.
  const interactionType =
    (live && state?.slideId && liveInteractionKind(slideType)) || null;
  const interaction = interactionType
    ? {
        type: interactionType,
        slideId: typeof state?.slideId === 'string' ? state.slideId : '',
      }
    : null;
  const dominantInteraction = !!interaction;
  const qaEnabled = isQaEnabledForPresentation(pres);
  return {
    canViewSlide: live && !!state?.slideId,
    canUseQa: live && !dominantInteraction && qaEnabled,
    canUseCaptions: false,
    canUseZoom: false,
    interaction: interaction || undefined,
  };
}
