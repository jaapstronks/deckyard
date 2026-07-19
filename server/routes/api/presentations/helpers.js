/**
 * Ids of slides this actor added in a save: present in the client's submitted
 * deck, absent from the server's pre-save deck, and surviving into the saved
 * result. Diffing the *submitted* slides (not the merged result) keeps a
 * concurrent editor's merge-appended slides out of this actor's "added" set,
 * and intersecting with the result drops slides the merge rejected.
 *
 * @param {Array<{id?: string}>} existingSlides - deck before the save
 * @param {Array<{id?: string}>} submittedSlides - deck the client sent
 * @param {Array<{id?: string}>} updatedSlides - deck after the save
 * @returns {string[]} newly added slide ids (deduped, order of first appearance)
 */
export function diffAddedSlideIds(existingSlides, submittedSlides, updatedSlides) {
  const ids = (arr) =>
    (Array.isArray(arr) ? arr : []).map((s) => s?.id).filter(Boolean);
  const existingIds = new Set(ids(existingSlides));
  const updatedIds = new Set(ids(updatedSlides));
  const seen = new Set();
  const added = [];
  for (const sid of ids(submittedSlides)) {
    if (existingIds.has(sid) || !updatedIds.has(sid) || seen.has(sid)) continue;
    seen.add(sid);
    added.push(sid);
  }
  return added;
}

export function parseIfMatchRevision(req) {
  const raw = String(req?.headers?.['if-match'] || '').trim();
  if (!raw) return null;
  // Accept: 12, "12", W/"12"
  const m = raw.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
