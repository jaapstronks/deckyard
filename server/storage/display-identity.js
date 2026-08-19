/**
 * Display identity — the shape a person takes in an API response.
 *
 * Deckyard's internal `/api` used to echo an email wherever a response had to
 * *name* someone: `updatedBy: "jaap@example.com"`, `actorEmail`, `createdBy`.
 * Decision D22 (2026-08-19) ends that: a response names a person with
 * `{ id, displayName }`, and an email crosses the boundary only where the
 * viewer has a claim on it — their own address, a collaborator they invited, a
 * share-link guest they addressed. Everything else got someone's contact
 * details for free because the display path happened to run through a column
 * that held one.
 *
 * ## Why `displayName` is computed here and not by the client
 *
 * The client used to do the work: read the email off the response, look up a
 * profile by that email, fall back to capitalizing the local part. Every step
 * of that needed the email in the browser, which is the thing being removed.
 * So the derivation moves behind the boundary — the same rule
 * (`shared/display-name.js`), applied once, server-side.
 *
 * ## Resolve first, then map
 *
 * {@link toDisplayIdentity} is synchronous and total: a row mapper calls it
 * and *always* gets the canonical shape, so no read path can emit a bare email
 * even when its caller skips the lookup. Without a lookup it derives the name
 * from the address; with one — {@link resolveDisplayNames}, a single batched
 * query per read — it uses the person's real name. That is why the lookup runs
 * *before* mapping rather than enriching the mapped objects afterwards: the
 * address is the lookup key, and by the time an object is mapped the address
 * is deliberately gone.
 *
 * ## The lookup is memoized
 *
 * `getPresentation` runs on nearly every request that touches a deck, so a
 * second round trip per read would land on the autosave path. A display name
 * changes when someone edits their profile — approximately never, relative to
 * request rate — so resolutions are cached in-process for
 * {@link CACHE_TTL_MS}. A name that is up to a minute stale renders one stale
 * label; a query per deck read costs every request forever. Misses are cached
 * too: an external collaborator must not re-query on every list render.
 *
 * ## Why no `actor_user_id` column
 *
 * Notifications and activity events store only an actor email. They are not
 * given an id column the way ownership stamps were (migrations 062/063/069/
 * 070), because those columns exist to be *compared* — an authorization key
 * must be stable and stored. A display identity is never compared; it is
 * rendered. Resolving it at read time keeps the write paths untouched and the
 * dual-key invariant confined to the places that actually decide something.
 *
 * @module storage/display-identity
 */

import { displayNameFromEmail } from '../../shared/display-name.js';
import { withDbGuard } from './utils/db-guard.js';

/**
 * A person as a response names them.
 *
 * @typedef {Object} DisplayIdentity
 * @property {string|null} id - The stable `users.id`, or null when the person
 *   has no user record on this instance (external collaborator, legacy row) —
 *   a defined absence, exactly as in shared/identity-match.js.
 * @property {string} displayName - What to render.
 */

/**
 * Resolved real names, keyed both ways.
 *
 * @typedef {Object} DisplayNameLookup
 * @property {(id: string|null|undefined) => string} forId
 * @property {(email: string|null|undefined) => string} forEmail
 * @property {(email: string|null|undefined) => string|null} idForEmail - The
 *   `users.id` behind an address, for the rows that store only an address.
 */

/**
 * The lookup a mapper gets when nobody resolved anything — every answer is
 * "no real name known", so {@link toDisplayIdentity} falls back to deriving
 * one from the address. Exported so a caller can name the no-lookup case
 * instead of passing `undefined` and hoping.
 *
 * @type {DisplayNameLookup}
 */
export const NO_DISPLAY_NAMES = Object.freeze({
  forId: () => '',
  forEmail: () => '',
  idForEmail: () => null,
});

/**
 * Build the display identity for one stamped person.
 *
 * @param {string|null} [id] - The stamped `users.id`, when the row has one.
 * @param {string|null} [email] - The stamped email.
 * @param {DisplayNameLookup} [lookup] - Resolved names from
 *   {@link resolveDisplayNames}; omitted means "derive from the address".
 * @returns {DisplayIdentity|null} `null` when the stamp names nobody — an
 *   unattributed row (a system write, a pruned actor) is an absence the client
 *   renders as such, not an identity with a blank name.
 */
export function toDisplayIdentity(id, email, lookup = NO_DISPLAY_NAMES) {
  const resolved =
    lookup.forId(id) || lookup.forEmail(email) || displayNameFromEmail(email);
  if (!id && !resolved) return null;
  return { id: id || null, displayName: resolved };
}

/**
 * Build a display identity from a stored `(email, name)` pair.
 *
 * Notifications and activity events carry a denormalized `actor_name` written
 * at event time — sometimes a real name, sometimes the email again (the
 * writers fall back to `actor?.name || actor?.email`). The stored name is used
 * only when it is actually a name; an address stored there is still an
 * address, and passing it through would reinstate the echo under a second
 * field name.
 *
 * @param {string|null} [email] - The stored actor email.
 * @param {string|null} [name] - The stored actor name, which may be an email.
 * @param {DisplayNameLookup} [lookup] - See {@link toDisplayIdentity}.
 * @returns {DisplayIdentity|null} See {@link toDisplayIdentity}.
 */
export function toStoredActorIdentity(email, name, lookup = NO_DISPLAY_NAMES) {
  const stored = String(name || '').trim();
  const usable = stored && !stored.includes('@') ? stored : '';
  // The row has no id column, so the id comes from the same lookup that
  // resolved the name — the client needs it to fetch the avatar image.
  const identity = toDisplayIdentity(lookup.idForEmail(email), email, lookup);
  if (!identity) return usable ? { id: null, displayName: usable } : null;
  // A resolved profile name outranks the one frozen into the event row; the
  // stored one outranks a name merely derived from the address.
  const resolved = lookup.forEmail(email);
  if (!resolved && usable) identity.displayName = usable;
  return identity;
}

/**
 * How long a resolved (or missing) display name stays good in-process.
 * See the module header for why staleness is the cheaper error here.
 */
const CACHE_TTL_MS = 60_000;

/** Hard bound on the memo, so a large instance cannot grow it without limit. */
const CACHE_MAX_ENTRIES = 2000;

/**
 * @type {Map<string, {name: string, userId: string|null, at: number}>}
 * `id:<uuid>` / `email:<address>` -> resolution. `userId` is only meaningful on
 * an `email:` key: it is what the address resolved to.
 */
const nameCache = new Map();

/**
 * Read a cached resolution, honouring the TTL.
 *
 * @param {string} key
 * @returns {{name: string, userId: string|null}|undefined} The cached
 *   resolution (`name: ''` for a known miss), or `undefined` when nothing
 *   usable is cached.
 */
function cacheGet(key) {
  const hit = nameCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    nameCache.delete(key);
    return undefined;
  }
  return hit;
}

/**
 * Store a resolution, evicting the oldest entry when the memo is full.
 * Map iteration order is insertion order, so the first key is the oldest.
 *
 * @param {string} key
 * @param {string} name - `''` records a known miss.
 * @param {string|null} [userId] - What an address resolved to, if anything.
 */
function cacheSet(key, name, userId = null) {
  nameCache.delete(key);
  nameCache.set(key, { name, userId, at: Date.now() });
  while (nameCache.size > CACHE_MAX_ENTRIES) {
    const oldest = nameCache.keys().next().value;
    if (oldest === undefined) break;
    nameCache.delete(oldest);
  }
}

/**
 * Drop every memoized display name.
 *
 * Called when a profile is written, so the person who just renamed themselves
 * sees it immediately rather than within the TTL. Clearing the whole memo
 * rather than one key keeps the invalidation honest: a rename affects the
 * entries under both the id and the address, and profile writes are rare.
 *
 * @returns {void}
 */
export function invalidateDisplayNames() {
  nameCache.clear();
}

/**
 * Normalize an email to the form `users.email` is stored in.
 *
 * @param {string} [email]
 * @returns {string}
 */
function normalize(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/**
 * Look up the real names behind a batch of identity stamps, in one query.
 *
 * Both keys are accepted because both shapes occur: ownership stamps carry a
 * `users.id` (migrations 062/063/069/070), event rows carry only an address.
 * A key that resolves to nothing is not an error — external collaborators and
 * legacy rows are expected to have no user record, and the caller already has
 * a derived name for them.
 *
 * Reads the profile name the way `storage/settings.js` does: the row keyed on
 * the stable id leads, the email-keyed row is the fallback for the rows the
 * migration-067 backfill could not key. Falls back again to `users.name`.
 *
 * @param {Array<{id?: string|null, email?: string|null}>} stamps
 * @returns {Promise<DisplayNameLookup>} Never throws for an empty batch or an
 *   unavailable database: it simply resolves nothing.
 */
export async function resolveDisplayNames(stamps) {
  const ids = new Set();
  const emails = new Set();
  for (const stamp of stamps || []) {
    if (stamp?.id) ids.add(stamp.id);
    const email = normalize(stamp?.email);
    if (email) emails.add(email);
  }
  if (!ids.size && !emails.size) return NO_DISPLAY_NAMES;

  // The answers for *this* batch, held locally. The returned lookup reads from
  // here, not back from the memo: the memo can be cleared by a concurrent
  // profile write or trimmed by its own size bound between the query and the
  // mapper that consumes the result, and neither may turn a resolved name
  // back into a derived one halfway through one response.
  /** @type {Map<string, {name: string, userId: string|null}>} */
  const resolved = new Map();
  const idList = [];
  const emailList = [];
  for (const id of ids) {
    const hit = cacheGet(`id:${id}`);
    if (hit) resolved.set(`id:${id}`, hit);
    else idList.push(id);
  }
  for (const email of emails) {
    const hit = cacheGet(`email:${email}`);
    if (hit) resolved.set(`email:${email}`, hit);
    else emailList.push(email);
  }

  // Only the keys the memo cannot answer reach the database.
  if (idList.length || emailList.length) {
    const rows = await withDbGuard([], async (db) =>
      db
        .selectFrom('users')
        .leftJoin(
          'user_settings as settings_by_id',
          'settings_by_id.user_id',
          'users.id',
        )
        .leftJoin(
          'user_settings as settings_by_email',
          'settings_by_email.email',
          'users.email',
        )
        .select([
          'users.id as id',
          'users.email as email',
          'users.name as name',
          'settings_by_id.settings as settingsById',
          'settings_by_email.settings as settingsByEmail',
        ])
        .where((eb) => {
          const clauses = [];
          if (idList.length) clauses.push(eb('users.id', 'in', idList));
          if (emailList.length)
            clauses.push(eb('users.email', 'in', emailList));
          return clauses.length === 1 ? clauses[0] : eb.or(clauses);
        })
        .execute(),
    );

    // Record the misses first, then overwrite the keys that did resolve: a key
    // with no row is a real answer ("no user record"), and not caching it
    // would re-query for every external collaborator on every render.
    const record = (key, name, userId = null) => {
      const entry = { name, userId };
      resolved.set(key, entry);
      cacheSet(key, name, userId);
    };
    for (const id of idList) record(`id:${id}`, '');
    for (const email of emailList) record(`email:${email}`, '');
    for (const row of rows) {
      // A user with no name on file still *is* a user: the id behind the
      // address is recorded even when the name is blank, so the client can
      // still key the avatar lookup on it.
      const name =
        profileName(row?.settingsById) ||
        profileName(row?.settingsByEmail) ||
        String(row?.name || '').trim();
      if (row.id) record(`id:${row.id}`, name);
      const email = normalize(row.email);
      if (email) record(`email:${email}`, name, row.id || null);
    }
  }

  const readEmail = (email) => {
    const key = normalize(email);
    return key ? resolved.get(`email:${key}`) : undefined;
  };
  return {
    forId: (id) => (id ? resolved.get(`id:${id}`)?.name || '' : ''),
    forEmail: (email) => readEmail(email)?.name || '',
    idForEmail: (email) => readEmail(email)?.userId || null,
  };
}

/**
 * Read `profile.name` out of a stored user-settings bag.
 *
 * @param {any} settings
 * @returns {string}
 */
function profileName(settings) {
  if (!settings || typeof settings !== 'object') return '';
  const profile = settings.profile;
  if (!profile || typeof profile !== 'object') return '';
  return typeof profile.name === 'string' ? profile.name.trim() : '';
}
