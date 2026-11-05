import { isFeatureEnabled } from '../config/flags-snapshot.js';
import { getAppSettings } from '../storage/settings.js';
import { getEditionAnalyticsSource } from '../storage/editions.js';
import { getPresentation } from '../storage/presentations/index.js';
import { createViewSession } from '../storage/analytics/index.js';
import { crossOrganizationScope } from '../storage/scope.js';

/**
 * Count one successfully served edition document through the existing deck
 * analytics store. Each request is anonymous and already complete: no cookie,
 * device id, IP, attribution, slide journey or inferred reading duration.
 * Call only after serving canvas/reader/embed, never for subresources/errors.
 * @param {string} repoRoot
 * @param {{publicationId: string, version: number}} edition - Resolved by the public route
 * @param {'published'|'reader'|'embed'} sourceType - The view served: the
 *   canvas, the reader or the frameable canvas
 * @returns {Promise<void>}
 */
export async function recordEditionVisit(repoRoot, edition, sourceType) {
  if (!isFeatureEnabled('analytics')) return;
  const publicScope = crossOrganizationScope(
    repoRoot,
    'edition analytics: a successfully served public edition identifies its source',
  );
  const settings = await getAppSettings(publicScope);
  if (!settings.analytics?.enabled) return;
  const source = await getEditionAnalyticsSource(
    publicScope,
    edition.publicationId,
  );
  if (!source) return;
  const scope = { repoRoot, organizationId: source.organizationId };
  const deck = await getPresentation(scope, source.presentationId);
  if (!deck || deck.settings?.analyticsEnabled === false) return;
  await createViewSession(scope, {
    presentationId: source.presentationId,
    sourceType,
    sourceId: `${edition.publicationId}/${edition.version}`,
    completed: true,
  });
}
