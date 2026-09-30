/**
 * Instance-health counters: which surfaces of this install are used (A7.3,
 * D246). One table, `instance_health (axis, key, day, count)`, and this
 * module is its only writer — every measuring point calls
 * {@link recordInstanceHealth} (or {@link countInstanceHealth}, its
 * fire-and-forget spelling), nothing else inserts into the table
 * (`tests/instance-health-single-writer.test.js`).
 *
 * The measure is days-active: a key's row for today is upserted once per
 * sighting, and the view (B516) reads how many days a key was seen and when
 * last, not the raw count. Autosave and refreshes inflate `count`; they cannot
 * inflate days.
 *
 * **Instance-level, so no scope.** The table holds no organization, person or
 * deck (D246, like `api_usage_daily`), so there is no organization for a
 * `StorageScope` to state; the functions take none
 * (`docs/reference/storage-scope.md` § Instance telemetry takes no scope).
 *
 * **The sandbox counts nowhere** (D248): a sandbox instance's decks are demos
 * built from the examples and would inflate exactly the example types, so on
 * a `SANDBOX_MODE` instance every write is a no-op. There is no other switch
 * (D251). Vocabulary, retention and what is deliberately not counted:
 * `docs/reference/instance-health.md`.
 */

import { sql } from 'kysely';
import { withDbGuard } from './utils/index.js';
import { sandboxEnabled } from '../config/sandbox.js';
import { fireAndForget } from '../utils/fire-and-forget.js';

/**
 * The axes a key may be counted on (D247). A key on any other axis is a
 * programming error, not an "unknown" bucket.
 */
export const INSTANCE_HEALTH_AXES = Object.freeze([
  'slide_type.authored',
  'slide_type.viewed',
  'surface',
  'export',
  'interaction',
  'mcp',
  'api_v1',
]);

/**
 * The closed vocabularies. An axis listed here counts only these keys; the
 * others (`slide_type.*`, `mcp`, `api_v1`) are keyed by a name their own
 * registry owns — a slide type, a tool, an operationId.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const INSTANCE_HEALTH_KEYS = Object.freeze({
  surface: Object.freeze(['share', 'published', 'embed', 'follow']),
  export: Object.freeze([
    'json',
    'deck',
    'html',
    'pdf',
    'pdf-slides',
    'png',
    'png-zip',
    'pptx',
    'pptx-template',
    'handoff',
    'notes-md',
    'notes-docx',
    'bulk',
  ]),
  interaction: Object.freeze([
    'poll_opened',
    'poll_vote',
    'likert_opened',
    'likert_vote',
    'feedback_submitted',
    'question_created',
    'live_session',
    'follow_code',
  ]),
});

/** The column width of `instance_health.key` (migration 089). */
const MAX_KEY_LENGTH = 128;

/** Rows older than this many days are pruned (D248: 13 months). */
export const INSTANCE_HEALTH_RETENTION_DAYS = 400;

/**
 * One counted sighting.
 *
 * @typedef {object} InstanceHealthEntry
 * @property {string} axis - One of {@link INSTANCE_HEALTH_AXES}.
 * @property {string} key - What was seen on that axis.
 */

/**
 * One stored row, as {@link readInstanceHealth} answers it.
 *
 * @typedef {object} InstanceHealthRow
 * @property {string} axis
 * @property {string} key
 * @property {string} day - `YYYY-MM-DD` (UTC).
 * @property {number} count
 */

/**
 * Refuse an entry outside the vocabulary.
 *
 * @param {InstanceHealthEntry} entry
 * @returns {void}
 * @throws {TypeError}
 */
function assertEntry({ axis, key }) {
  if (!INSTANCE_HEALTH_AXES.includes(axis)) {
    throw new TypeError(`instance health: unknown axis '${axis}'`);
  }
  if (typeof key !== 'string' || key === '') {
    throw new TypeError(`instance health: empty key on axis '${axis}'`);
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new TypeError(
      `instance health: key longer than ${MAX_KEY_LENGTH} on axis '${axis}'`,
    );
  }
  const closed = INSTANCE_HEALTH_KEYS[axis];
  if (closed && !closed.includes(key)) {
    throw new TypeError(`instance health: unknown key '${key}' on '${axis}'`);
  }
}

/**
 * Today as the table stores it: the UTC calendar day.
 * @returns {string}
 */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A `date` column as `YYYY-MM-DD`. The pg driver hands a `date` back as a
 * `Date` at local midnight, so the local components are the stored day.
 *
 * @param {Date|string} value
 * @returns {string}
 */
function toDay(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const pad = (n) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * Count one event's sightings for today: one multi-row upsert, each distinct
 * `(axis, key)` once. A no-op without a database and on a sandbox instance.
 *
 * @param {InstanceHealthEntry[]} entries
 * @returns {Promise<void>}
 * @throws {TypeError} When an entry names an axis or key outside the
 *   vocabulary.
 */
export async function recordInstanceHealth(entries) {
  for (const entry of entries) assertEntry(entry);
  if (sandboxEnabled()) return;

  const day = today();
  const seen = new Set();
  const rows = [];
  for (const { axis, key } of entries) {
    // One statement may not touch the same row twice (PostgreSQL refuses an
    // ON CONFLICT that would), so a repeated sighting in one event is one.
    const id = `${axis}\u0000${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({ axis, key, day, count: 1 });
  }
  if (!rows.length) return;

  await withDbGuard(undefined, async (db) => {
    await db
      .insertInto('instance_health')
      .values(rows)
      .onConflict((oc) =>
        oc.columns(['axis', 'key', 'day']).doUpdateSet({
          count: sql`COALESCE(instance_health.count, 0) + ${1}`,
        }),
      )
      .execute();
  });
}

/**
 * {@link recordInstanceHealth} for a measuring point that must not wait on
 * it or fail because of it: the request goes on, a rejection is a log line.
 *
 * @param {InstanceHealthEntry[]} entries
 * @returns {void}
 */
export function countInstanceHealth(entries) {
  fireAndForget(recordInstanceHealth(entries), 'instance health');
}

/**
 * One entry per distinct slide type a deck carries, on a `slide_type.*`
 * axis. Every language version is read, not just the top-level slides: a type
 * that lives only in a translation is still in the deck.
 *
 * @param {'slide_type.authored'|'slide_type.viewed'} axis
 * @param {object|null|undefined} pres - A presentation as the facade reads it.
 * @returns {InstanceHealthEntry[]}
 */
export function slideTypeEntries(axis, pres) {
  const lists = [pres?.slides];
  const versions = pres?.i18n?.versions;
  if (versions && typeof versions === 'object') {
    for (const version of Object.values(versions)) lists.push(version?.slides);
  }
  const types = new Set();
  for (const slides of lists) {
    if (!Array.isArray(slides)) continue;
    for (const slide of slides) {
      if (typeof slide?.type === 'string' && slide.type) types.add(slide.type);
    }
  }
  return [...types].sort().map((key) => ({ axis, key }));
}

/**
 * Count one public view of a deck: the surface it was seen on and every slide
 * type it carries. The four viewing handlers call this; opening a deck in the
 * editor is not a view (D247).
 *
 * @param {'share'|'published'|'embed'|'follow'} surface
 * @param {object} pres
 * @returns {void}
 */
export function countDeckView(surface, pres) {
  countInstanceHealth([
    { axis: 'surface', key: surface },
    ...slideTypeEntries('slide_type.viewed', pres),
  ]);
}

/**
 * The stored rows from `sinceDay` on, oldest first.
 *
 * @param {object} [opts]
 * @param {string} [opts.sinceDay] - `YYYY-MM-DD`; omitted, every row.
 * @returns {Promise<InstanceHealthRow[]>} `[]` without a database.
 */
export async function readInstanceHealth({ sinceDay } = {}) {
  return withDbGuard([], async (db) => {
    let query = db.selectFrom('instance_health').selectAll();
    if (sinceDay) query = query.where('day', '>=', sinceDay);
    const rows = await query
      .orderBy('day', 'asc')
      .orderBy('axis', 'asc')
      .orderBy('key', 'asc')
      .execute();
    return rows.map((row) => ({
      axis: row.axis,
      key: row.key,
      day: toDay(row.day),
      count: Number(row.count) || 0,
    }));
  });
}

/**
 * Delete every row from before `cutoffDay`. The retention job passes the day
 * {@link INSTANCE_HEALTH_RETENTION_DAYS} back.
 *
 * @param {string} cutoffDay - `YYYY-MM-DD`; rows on this day stay.
 * @returns {Promise<number>} Rows deleted; `0` without a database.
 */
export async function pruneInstanceHealth(cutoffDay) {
  return withDbGuard(0, async (db) => {
    const result = await db
      .deleteFrom('instance_health')
      .where('day', '<', cutoffDay)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0);
  });
}
