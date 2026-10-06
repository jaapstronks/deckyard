/** Run independent row tasks with bounded concurrency and stable result order.
 * `shouldContinue` is checked before each new task; in-flight tasks finish.
 * Unstarted rows retain an undefined result, so callers can distinguish a
 * stopped batch from a failed row without inventing an error.
 */
export async function runBatchTasks(
  rows,
  task,
  { concurrency = 3, shouldContinue = () => true } = {},
) {
  const input = Array.from(rows || []);
  const results = new Array(input.length);
  const limit = Math.max(1, Math.floor(Number(concurrency) || 1));
  let next = 0;

  async function worker() {
    while (next < input.length && shouldContinue()) {
      const index = next++;
      try {
        results[index] = {
          status: 'fulfilled',
          value: await task(input[index], index),
        };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, input.length) }, () => worker()),
  );
  return results;
}
