/**
 * AI Schema Validation Module
 *
 * The one Zod address in the tree (`tests/zod-scope-guard.test.js`), and since
 * D87 the only content schema: `content-schema.js` derives a type's schema from
 * its `fields[]` instead of restating it. The 32 hand-written per-type schemas
 * this barrel used to re-export are gone — they were a second spelling of the
 * registry, and they had drifted from it.
 *
 * Usage:
 * ```js
 * import { validateSlideContent } from './schemas/index.js';
 *
 * const { valid, issues } = validateSlideContent(slideTypes['list-slide'], content);
 * ```
 */

export {
  contentSchemaFor,
  describeIssue,
  validateSlideContent,
} from './content-schema.js';
