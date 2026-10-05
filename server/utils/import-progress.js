/**
 * Import progress ladder
 *
 * One progress model for every import that streams over SSE (file conversion,
 * Notion). The phases are the same everywhere, so the numbers live here rather
 * than being re-picked per route — a second ladder is how the bar started
 * walking backwards (B595).
 *
 * The ladder is monotone by construction: each phase starts where the previous
 * one ended, and the two phases that are a single model call creep toward the
 * next floor instead of standing still. Contract and rationale:
 * `docs/reference/import-progress.md`.
 */

/** Phase boundaries, in percent. */
export const PROGRESS = Object.freeze({
  /** Accepted, reading and parsing the source. */
  parse: 5,
  /** First section group written; the outline creep may approach but not reach this. */
  refineFloor: 55,
  /** All section groups written. */
  refineCeiling: 85,
  /** Assembling the deck. */
  building: 90,
  /** Writing it to the library. */
  save: 95,
});

/**
 * Expected wall-clock of the outline call, used as the creep's time constant.
 * Measured at ~34s for a document import (gpt-5.2, 2026-10-05); the creep is
 * asymptotic, so a slower call keeps moving and a faster one is simply
 * overtaken by the first real event.
 */
export const OUTLINE_CREEP_MS = 35000;

/**
 * Expected wall-clock of the refine phase, used as its creep's time constant.
 * `onGroupDone` is real progress, but `refineAllSlideGroups` runs up to six
 * groups in parallel: a deck with one batch reports nothing until the batch
 * lands. The creep covers that window; a real tick overtakes it.
 */
export const REFINE_CREEP_MS = 25000;
