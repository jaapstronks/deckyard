import { methodNotAllowed, serveJson, notFound, serverError } from '../../../utils/http.js';
import {
  getFollowStateForPresentation,
} from '../../../storage/present-sessions.js';
import { getPresentationCached } from '../../../storage/presentation-cache.js';
import { computeAudienceCapabilitiesFromState } from './helpers.js';
import { createLogger } from '../../../utils/logger.js';
const log = createLogger('state');

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
    log.error('[follow/state] Failed to get follow state:', err);
    serverError(res, 'Failed to load follow state');
    return true;
  }
}
