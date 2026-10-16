/**
 * Export progress ladder
 *
 * The export twin of `server/utils/import-progress.js`: one progress model for
 * every export that streams over SSE (`/export/<fmt>/stream`), so the numbers
 * live here rather than being re-picked per format. Contract and rationale:
 * `docs/reference/import-progress.md` § Exports.
 *
 * A Chrome export is a loop over slides, so the measurable unit is a rendered
 * slide: the builders report `{ done, total }` through `onProgress`, and this
 * module turns that into the `status` event the loading modal reads. The
 * server-rendered PDF is one Chrome call for the whole deck and cannot report
 * inside it; it creeps instead (`creepTo`), the way the outline call of an
 * import does.
 */

/** Phase boundaries, in percent. */
export const EXPORT_PROGRESS = Object.freeze({
  /** Accepted, the deck read and the first render starting. */
  start: 3,
  /** The slide loop runs from here... */
  renderFloor: 5,
  /** ...to here, one step per rendered slide. */
  renderCeiling: 90,
  /** Packing the file (zip, pptx write) after the last slide. */
  pack: 95,
});

/**
 * Expected wall-clock per slide of a one-document render (the PDF), used as
 * the creep's time constant. Measured at ~175 ms for a 54-slide photo deck on
 * dev-server-1 (B468, 2026-10-16); the creep is asymptotic, so a slower box
 * keeps moving and a faster one is overtaken by `complete`.
 */
export const DOCUMENT_CREEP_MS_PER_SLIDE = 250;

/**
 * The `status` event for one step of a slide loop.
 *
 * `unit` says what is being counted: `slide` for an export that renders each
 * slide once, `step` for the handoff ZIP, which renders the deck more than
 * once and counts every render. The client words the counter from it.
 *
 * @param {{ done: number, total: number, unit?: 'slide'|'step' }} step
 * @returns {{ phase: 'render'|'pack', progress: number, done: number,
 *   total: number, unit: string }}
 */
export function exportStatus({ done, total, unit = 'slide' }) {
  const span = EXPORT_PROGRESS.renderCeiling - EXPORT_PROGRESS.renderFloor;
  const share = total > 0 ? Math.min(1, done / total) : 0;
  const finished = total > 0 && done >= total;
  return {
    phase: finished ? 'pack' : 'render',
    progress: finished
      ? EXPORT_PROGRESS.pack
      : Math.round(EXPORT_PROGRESS.renderFloor + span * share),
    done,
    total,
    unit,
  };
}

/**
 * Count a builder's slide loop toward one `onProgress` callback.
 *
 * Several renders can share one counter (the handoff ZIP runs the PowerPoint
 * rasters and the PNG folder against the same total), and a builder without a
 * caller that listens costs nothing.
 *
 * @param {((step: { done: number, total: number, unit: string }) => void)|undefined} onProgress
 * @param {number} total
 * @param {{ unit?: 'slide'|'step' }} [opts]
 * @returns {() => void} call once per finished slide
 */
export function progressCounter(onProgress, total, { unit = 'slide' } = {}) {
  let done = 0;
  return () => {
    done += 1;
    onProgress?.({ done, total, unit });
  };
}
