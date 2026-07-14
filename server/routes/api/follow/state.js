import { methodNotAllowed, serveJson, notFound } from '../../../utils/http.js';
import {
  getFollowStateForPresentation,
} from '../../../storage/present-sessions.js';
import { getPresentationCached } from '../../../storage/presentation-cache.js';
import { computeAudienceCapabilitiesFromState } from './helpers.js';

export async function handleFollowState({ repoRoot, req, res }, presentationId) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  try {
    const state = await getFollowStateForPresentation(repoRoot, presentationId);
    const pres = await getPresentationCached(repoRoot, presentationId);
    if (!pres) {
      return notFound(res, 'Presentation not found');
    }
    serveJson(res, 200, {
      ...state,
      capabilities: computeAudienceCapabilitiesFromState(state, pres),
    });
    return true;
  } catch (err) {
    console.error('[follow/state] Failed to get follow state:', err);
    serveJson(res, 500, { error: 'Failed to load follow state' });
    return true;
  }
}
