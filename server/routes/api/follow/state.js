import { methodNotAllowed, serveJson, notFound } from '../../../utils/http.js';
import { getFollowStateForPresentation } from '../../../storage/live-sessions/index.js';
import { getPresentationCached } from '../../../storage/presentations/index.js';
import { normalizeLang } from '../../../../shared/i18n-utils.js';
import {
  computeAudienceCapabilitiesFromState,
  followAudienceState,
  followAudienceScope,
  loadFollowAudience,
} from './helpers.js';

export async function handleFollowState(
  { repoRoot, req, res, url },
  presentationId,
) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const state = await getFollowStateForPresentation(
    followAudienceScope(repoRoot),
    presentationId,
  );
  const pres = await getPresentationCached(
    followAudienceScope(repoRoot),
    presentationId,
  );
  if (!pres) {
    return notFound(res, 'Presentation not found');
  }
  const projected = await loadFollowAudience(
    repoRoot,
    pres,
    normalizeLang(url?.searchParams.get('lang')),
  );
  const audienceState = followAudienceState(state, pres, projected);
  serveJson(res, 200, {
    ...audienceState,
    capabilities: computeAudienceCapabilitiesFromState(audienceState, pres),
  });
  return true;
}
