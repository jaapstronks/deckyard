/**
 * Cross-store helpers — the sole public seam over `server/storage/utils/`.
 *
 * Not a store: nothing here reads or writes a domain table. It holds the two
 * things every store needs and none of them owns — the database-availability
 * guard, and the small value helpers (`parseJson`, slug handling, e-mail →
 * user id) that were duplicated across stores before they moved here.
 *
 * Consumers import this barrel, not `./db-guard.js` or `./helpers.js`
 * (`AGENTS.md` § _Module layout: one folder = one seam_), which is what
 * `tests/storage-module-layout.test.js` pins.
 */

export { withDbGuard } from './db-guard.js';

export {
  parseJson,
  generateSlug,
  isValidSlug,
  getUserIdByEmail,
} from './helpers.js';
