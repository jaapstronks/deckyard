/** Registry-dependent checks for copies of custom-type content (B849). */
import { withContentTransaction } from '../db/client.js';
import { getOrgId } from '../utils/context.js';
import { toStorageContext } from './scope.js';

import { undeclaredContentKeys } from '../../shared/slide-types/declared-keys.js';
import { getSlideType } from '../../shared/slide-types/registry.js';
import { buildMergedSlideTypes } from '../utils/custom-slide-type-runtime.js';
import { AppError } from '../utils/errors.js';

/**
 * Refuse obsolete custom fields inside the content transaction, even on a
 * snapshot or an unchanged submitted slide. Other field validation remains
 * with the authoring contract; historical snapshots need not meet today's
 * required-field rules.
 * @param {import('./scope.js').StorageScope} scope
 * @param {Array<object>} slides
 * @param {Record<string, object>} [slideTypes]
 */
export async function assertCurrentCustomFields(scope, slides, slideTypes) {
  if (!slides?.length) return;
  const registry = slideTypes || (await buildMergedSlideTypes(scope));
  for (const slide of slides || []) {
    const def = getSlideType(slide?.type, registry);
    if (!def?.isCustom) continue;
    const [field] = undeclaredContentKeys(def, slide?.content);
    if (field)
      throw new AppError(
        `Unknown field "${field}": slide type ${slide.type} does not declare it`,
        400,
        { field },
        'unknown_field',
      );
  }
}

/**
 * Every language buffer of a deck or snapshot.
 * @param {object} deck
 * @returns {Array<object>}
 */
export function contentSlides(deck) {
  return [
    ...(Array.isArray(deck?.slides) ? deck.slides : []),
    ...Object.values(deck?.i18n?.versions || {}).flatMap((version) =>
      Array.isArray(version?.slides) ? version.slides : [],
    ),
  ];
}

/**
 * Run a registry-dependent storage operation under its organization's lock.
 * @template T
 * @param {import('./scope.js').StorageScope} scope
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withContentWrite(scope, fn) {
  return withContentTransaction(
    getOrgId(toStorageContext(scope, 'contentWrite')),
    fn,
  );
}
