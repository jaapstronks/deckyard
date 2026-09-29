/**
 * Instance-health counters: which surfaces of this install are used (A7.3,
 * D246). One facade, one writer — every measuring point calls
 * {@link recordInstanceHealth}; nothing else writes the table.
 *
 * **Stub (B515).** The table (`instance_health`, migration 089) and the upsert
 * arrive with B514. Until then the call is validated and dropped, so the
 * measuring points can be wired ahead of the storage without a table that
 * does not exist yet. B514 replaces the body of `recordInstanceHealth` and
 * removes the test recorder below; its callers do not change.
 */

/**
 * The axes a key may be counted on (D247). A key on any other axis is a
 * programming error, not an "unknown" bucket.
 */
export const INSTANCE_HEALTH_AXES = Object.freeze(['api_v1']);

/**
 * One counted sighting.
 *
 * @typedef {object} InstanceHealthEntry
 * @property {string} axis - One of {@link INSTANCE_HEALTH_AXES}.
 * @property {string} key - What was seen on that axis (e.g. an operationId).
 */

/** @type {((entries: InstanceHealthEntry[]) => void) | null} */
let testRecorder = null;

/**
 * Count one event's sightings for today. Fire-and-forget at the call site.
 *
 * @param {InstanceHealthEntry[]} entries
 * @returns {Promise<void>}
 * @throws {TypeError} When an entry names an axis outside the vocabulary or an
 *   empty key.
 */
export async function recordInstanceHealth(entries) {
  for (const { axis, key } of entries) {
    if (!INSTANCE_HEALTH_AXES.includes(axis)) {
      throw new TypeError(`instance health: unknown axis '${axis}'`);
    }
    if (typeof key !== 'string' || key === '') {
      throw new TypeError(`instance health: empty key on axis '${axis}'`);
    }
  }
  testRecorder?.(entries);
}

/**
 * Test seam until B514's table exists: observe what would have been written.
 * Pass `null` to detach.
 *
 * @param {((entries: InstanceHealthEntry[]) => void) | null} recorder
 * @returns {void}
 */
export function __setInstanceHealthRecorderForTest(recorder) {
  testRecorder = recorder;
}
