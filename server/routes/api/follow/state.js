import { methodNotAllowed, serveJson, notFound } from '../../../utils/http.js';
import {
  getFollowStateForPresentation,
} from '../../../storage/live-sessions/index.js';
import { getPresentationCached } from '../../../storage/presentations/cache.js';
import { computeAudienceCapabilitiesFromState, followAudienceScope } from './helpers.js';

export async function handleFollowState({ repoRoot, req, res }, presentationId) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const state = await getFollowStateForPresentation(followAudienceScope(repoRoot), presentationId);
  const pres = await getPresentationCached(followAudienceScope(repoRoot), presentationId);
  if (!pres) {
    return notFound(res, 'Presentation not found');
  }
  serveJson(res, 200, {
    ...state,
    capabilities: computeAudienceCapabilitiesFromState(state, pres),
  });
  return true;
}
