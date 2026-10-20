import { buildMergedSlideTypes } from './custom-slide-type-runtime.js';
import {
  projectPresentationForAudience,
  filterForShareViewer,
} from './public-output.js';

/**
 * Resolve the deck organization's jump fields and project a non-author read.
 * Call only after read authorization and the actor's deck-write decision.
 * @param {Object} storageScope
 * @param {Object} pres
 * @param {'viewer'|'share'} [channel='viewer']
 * @returns {Promise<Object>}
 */
export async function projectReaderPresentation(
  storageScope,
  pres,
  channel = 'viewer',
) {
  const slideTypes = await buildMergedSlideTypes({
    ...storageScope,
    organizationId: pres.organizationId,
  });
  if (channel === 'share') return filterForShareViewer(pres, { slideTypes });
  return projectPresentationForAudience(pres, {
    audience: 'reader',
    channel,
    slideTypes,
  });
}
