/**
 * Reading the instance-health counters back in a test.
 *
 * Every measuring point counts fire-and-forget (`countInstanceHealth`), so a
 * handler has answered before its row is written. {@link healthKeys} waits
 * for those writes to land, then answers what the database double holds as
 * `axis:key` strings — the spelling `docs/reference/instance-health.md` uses.
 */

/**
 * Let the fire-and-forget writes queued so far reach the database double. On
 * the double every query settles in microtasks, so a macrotask turn is enough.
 * @returns {Promise<void>}
 */
export async function settleInstanceHealth() {
  await new Promise((resolve) => setImmediate(resolve));
}

/**
 * The counted `axis:key` pairs, sorted, after the pending writes have landed.
 *
 * @param {{ __tables: Record<string, object[]> }} db - A `createFakeDb` double.
 * @param {string} [axisPrefix] - Only the axes starting with this.
 * @returns {Promise<string[]>}
 */
export async function healthKeys(db, axisPrefix = '') {
  await settleInstanceHealth();
  return (db.__tables.instance_health || [])
    .filter((row) => row.axis.startsWith(axisPrefix))
    .map((row) => `${row.axis}:${row.key}`)
    .sort();
}
