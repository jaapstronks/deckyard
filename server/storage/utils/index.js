/**
 * Cross-store helpers — the sole public seam over `server/storage/utils/`.
 *
 * Not a store: it holds the small helpers (`parseJson`, e-mail → user id,
 * `LIKE`-pattern escaping) that no one store owns, most of them because they
 * were duplicated across stores before they moved here. The
 * database-availability guard `withDbGuard` is a database primitive and lives
 * in `server/db/client.js` (B665).
 *
 * Consumers import this barrel, not `./helpers.js` (`AGENTS.md` § _Module
 * layout: one folder = one seam_), which is what `tests/module-layout.test.js`
 * pins.
 */

export { parseJson, getUserIdByEmail, escapeLikePattern } from './helpers.js';
