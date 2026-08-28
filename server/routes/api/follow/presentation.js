import { notFound, methodNotAllowed, serveJson } from '../../../utils/http.js';
import { getFollowStateForPresentation } from '../../../storage/live-sessions/index.js';
import { getPresentation } from '../../../storage/presentations/index.js';
import {
  computeMissingTranslation,
  pickVersion,
} from '../../../../shared/i18n-progress.js';
import { crossOrganizationScope } from '../../../storage/scope.js';
import {
  normalizeLang,
  resolveDeckLang,
  translationSourceFor,
} from '../../../../shared/i18n-utils.js';
import { customThemeConfig } from '../../../utils/themes.js';
import {
  computeAudienceCapabilitiesFromState,
  followAudienceScope,
  followMetaFromPresentation,
  pickPresentationForLang,
} from './helpers.js';

export async function handleFollowPresentation(
  { repoRoot, req, res, url },
  presentationId,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const lang = normalizeLang(url.searchParams.get('lang'));
  const state = await getFollowStateForPresentation(
    followAudienceScope(repoRoot),
    presentationId,
  );
  if (state.status !== 'live') {
    serveJson(res, 200, {
      ...state,
      capabilities: computeAudienceCapabilitiesFromState(state, null),
      presentation: null,
    });
    return true;
  }
  const pres = await getPresentation(
    crossOrganizationScope(
      repoRoot,
      'follow-along audience: the live follow code is the authorization',
    ),
    presentationId,
  );
  if (!pres) return notFound(res);
  const meta = followMetaFromPresentation(pres, {
    includeTranslationStatus: true,
  });

  // If the requested language version is missing or incomplete, signal "translating".
  if (lang) {
    const hasVersion =
      pres?.i18n?.versions &&
      typeof pres.i18n.versions === 'object' &&
      !!pres.i18n.versions?.[lang];
    // The source is the dominant version, whatever `lang` is — "the other one"
    // only had an answer inside the NL/EN pair, so an incomplete German version
    // used to measure itself against the deck's top-level fields (D72).
    const srcLang = translationSourceFor(pres, lang);
    const missing =
      hasVersion && srcLang
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
          pres,
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
      // The language these slides are actually in, so the audience view can
      // ask `resolveDeckLang(pres)` like every other render surface instead of
      // second-guessing from the query string. When a version was requested it
      // was served (the branch above turned a missing one into "translating");
      // otherwise these are `pres.slides`, whose language resolveDeckLang
      // already names. Without it the built-in copy of poll, likert and
      // feedback slides fell back to DEFAULT_SLIDE_COPY_LANG for every
      // audience (docs/reference/slide-copy-language.md).
      lang: lang || resolveDeckLang(pres),
      // A database theme resolves through a route behind the login gate, so
      // the audience — anonymous by definition — saw a 401 and followed along
      // on an unbranded deck. The theme rides on the payload the follow code
      // already authorizes (server/utils/themes.js § customThemeConfig);
      // null for a built-in, which the client loads from /themes/ itself.
      themeConfig: await customThemeConfig(repoRoot, picked.theme),
      slides: Array.isArray(picked.slides) ? picked.slides : [],
    },
  });
  return true;
}
