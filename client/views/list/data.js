/**
 * Presentation-list data loading + normalization.
 *
 * Fetches the owner's decks and the shared-with-me decks in parallel (with
 * graceful fallbacks), splits them into workspace / private buckets, drops
 * shared duplicates already present in the main list, and produces a single
 * date-sorted view.
 */

/**
 * @param {(path: string) => Promise<any>} api
 * @returns {Promise<{
 *   workspace: object[], priv: object[],
 *   sharedPresentations: object[], allByDate: object[],
 * }>}
 */
export async function loadPresentationList(api) {
  // Fetch main list and shared presentations in parallel with graceful fallbacks
  const [list, sharedResp] = await Promise.all([
    api('/api/presentations').catch(() => []),
    api('/api/presentations/shared-with-me').catch(() => ({
      presentations: [],
    })),
  ]);

  const workspace = [];
  const priv = [];

  // Track IDs from main list to avoid duplicates with shared
  const mainListIds = new Set();

  for (const p of Array.isArray(list) ? list : []) {
    mainListIds.add(p.id);
    if (p?.visibility === 'organization') {
      workspace.push(p);
    } else {
      priv.push(p);
    }
  }

  // Process shared presentations (mark them and exclude duplicates)
  const sharedPresentations = (sharedResp?.presentations || [])
    .filter((p) => !mainListIds.has(p.id))
    .map((p) => ({
      ...p,
      isSharedWithMe: true,
    }));

  const getTimestamp = (p) => {
    // For shared presentations, use sharedAt as the primary date
    const dateStr = p.sharedAt || p.updatedAt || p.createdAt;
    if (!dateStr) return 0;
    const time = new Date(dateStr).getTime();
    return Number.isNaN(time) ? 0 : time;
  };

  const allByDate = [...workspace, ...priv, ...sharedPresentations].sort(
    (a, b) => getTimestamp(b) - getTimestamp(a),
  );

  return { workspace, priv, sharedPresentations, allByDate };
}
