export function parseIfMatchRevision(req) {
  const raw = String(req?.headers?.['if-match'] || '').trim();
  if (!raw) return null;
  // Accept: 12, "12", W/"12"
  const m = raw.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * The slide-level merge inputs an editor save sends as headers, parsed into
 * the save service's input (B608). A malformed header reads as absent, so the
 * merge falls back to the plain revision check.
 *
 *   - `X-Modified-Slides`: JSON array of the slide ids this save changed;
 *   - `X-Slide-Base-Fingerprints`: JSON object id → hash of each modified
 *     slide's base, so the merge detects slides also changed server-side since
 *     (shared/slide-fingerprint.js) instead of last-writer-wins;
 *   - `X-Slides-Order-Changed`: whether the client reordered since its base;
 *     `0` keeps the server's order authoritative (a stale tab must not
 *     reshuffle the deck), absent means a legacy client and the old behaviour.
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {{ modifiedSlideIds: string[]|null, slideBaseFingerprints: Object|null, clientReordered: boolean|null }}
 */
export function parseSlideMergeHeaders(req) {
  const json = (name) => {
    const raw = req?.headers?.[name];
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const modified = json('x-modified-slides');
  const fingerprints = json('x-slide-base-fingerprints');
  const orderChanged = req?.headers?.['x-slides-order-changed'];
  let clientReordered = null;
  if (orderChanged === '1' || orderChanged === 'true') clientReordered = true;
  else if (orderChanged === '0' || orderChanged === 'false') {
    clientReordered = false;
  }
  return {
    modifiedSlideIds: Array.isArray(modified) ? modified : null,
    slideBaseFingerprints:
      fingerprints &&
      typeof fingerprints === 'object' &&
      !Array.isArray(fingerprints)
        ? fingerprints
        : null,
    clientReordered,
  };
}
