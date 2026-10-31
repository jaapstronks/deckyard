/**
 * Until T1.5 a publish rendered a preview image of the deck and stored it
 * under a name of this shape. No publication uses one any more (an edition's
 * preview is its own `/og`); the name is kept so the static route can refuse
 * the leftover files and `scripts/sweep-published-previews.js` can find them,
 * without touching any other upload.
 *
 * @param {string} name - A file name, no directory
 * @returns {boolean}
 */
export function isPublishedPreviewAssetName(name) {
  return /^og-(?:[a-f0-9]{8}|v2-[a-f0-9]{8}-[a-f0-9]{20})-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.png$/.test(
    name,
  );
}
