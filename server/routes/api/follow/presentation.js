import { notFound, methodNotAllowed, serveJson } from '../../../utils/http.js';
import { getFollowStateForPresentation } from '../../../storage/present-sessions.js';
import { getPresentation } from '../../../storage/presentations.js';
import {
  computeMissingTranslation,
  normalizeLang,
  otherLang,
  pickVersion,
} from '../../../utils/translation-status.js';
import {
  computeAudienceCapabilitiesFromState,
  followMetaFromPresentation,
  pickPresentationForLang,
} from './helpers.js';

export async function handleFollowPresentation(
  { repoRoot, req, res, url },
  presentationId
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const lang = normalizeLang(url.searchParams.get('lang'));
  const state = await getFollowStateForPresentation(repoRoot, presentationId);
  if (state.status !== 'live') {
    serveJson(res, 200, {
      ...state,
      capabilities: computeAudienceCapabilitiesFromState(state, null),
      presentation: null,
    });
    return true;
  }
  const pres = await getPresentation(repoRoot, presentationId);
  if (!pres) return notFound(res);
  const meta = followMetaFromPresentation(pres, { includeTranslationStatus: true });

  // If the requested language version is missing or incomplete, signal "translating".
  if (lang) {
    const hasVersion =
      pres?.i18n?.versions &&
      typeof pres.i18n.versions === 'object' &&
      !!pres.i18n.versions?.[lang];
    const srcLang = otherLang(lang);
    const missing = hasVersion
      ? computeMissingTranslation({
          source: pickVersion(pres, srcLang),
          target: pickVersion(pres, lang),
        }).missingCount
      : null;
    if (!hasVersion || (typeof missing === 'number' && missing > 0)) {
      serveJson(res, 200, {
        ...state,
        status: 'translating',
        lang,
        meta,
        missing: typeof missing === 'number' ? missing : null,
        job:
          pres?.i18n?.translation?.[lang] &&
          typeof pres.i18n.translation[lang] === 'object'
            ? pres.i18n.translation[lang]
            : null,
        capabilities: computeAudienceCapabilitiesFromState(
          { ...state, status: 'translating' },
          pres
        ),
        presentation: null,
      });
      return true;
    }
  }

  const picked = pickPresentationForLang(pres, lang);
  serveJson(res, 200, {
    ...state,
    lang: lang || null,
    meta,
    capabilities: computeAudienceCapabilitiesFromState(state, pres),
    presentation: {
      id: picked.id,
      title: picked.title,
      theme: picked.theme,
      slides: Array.isArray(picked.slides) ? picked.slides : [],
    },
  });
  return true;
}
