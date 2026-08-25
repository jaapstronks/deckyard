import { translatableKeysForType as keysForType } from '../../../shared/slide-types/text-fields.js';

/**
 * Top-level translatable keys for a slide type, with the registry injected so
 * the editor uses exactly the registry it rendered with. The rule itself lives
 * in `shared/slide-types/text-fields.js`.
 * @param {Object} args
 * @param {Object} args.SLIDE_TYPES - Slide-type registry
 * @param {string} args.type - Slide type name
 * @returns {string[]}
 */
export function translatableKeysForType({ SLIDE_TYPES, type } = {}) {
  return keysForType(type, SLIDE_TYPES);
}
