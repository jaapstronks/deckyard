/**
 * Targeted write of one slide's speaker notes.
 *
 * Notes are a single markdown string per slide, carried in the deck document
 * (`slides[].notes`). The editor writes them as part of a whole-deck PUT with
 * `If-Match`; the notes companion cannot, because the visitor holding a
 * present-session link has no revision to match against and no business
 * replacing the rest of the deck. So this seam exists: read, replace exactly
 * one field on exactly one slide, write the slides column and nothing else.
 *
 * The write still passes through `updatePresentation`, which means it inherits
 * the shared slide-lock policy (a locked slide is a 423) and the
 * `deckUpdated` broadcast that refreshes the editor and any other companion.
 *
 * Concurrency is deliberately last-write-wins on that one field: notes are one
 * string per slide, so the conflict window is a single sentence, and a merge
 * mechanism would cost more than it buys (see
 * `docs/reference/notes-companion.md`, § Concurrency).
 *
 * @module server/storage/presentations/slide-notes
 */

import { updatePresentation } from './index.js';

/**
 * Replace one slide's speaker notes, leaving every other field alone.
 *
 * Takes the already-loaded presentation rather than an id: the caller resolved
 * it through a public token and needs it anyway, and re-reading here would only
 * widen the window between the check and the write.
 *
 * @param {import('../scope.js').StorageScope} scope - Organization-scoped: this
 *   is a write, so it may not run cross-organization. Derive the organization
 *   from the deck the token addressed (`presentation.organizationId`).
 * @param {Object} presentation - The stored deck, as `getPresentation` answers it.
 * @param {Object} patch
 * @param {string} patch.slideId - Which slide's notes to replace.
 * @param {string} patch.notes - The new notes markdown ('' clears them).
 * @returns {Promise<{ok: true, slideId: string, notes: string, revision: number|null, changed: boolean}
 *   | {ok: false, reason: string, errors?: Array}>}
 */
export async function updateSlideNotes(scope, presentation, { slideId, notes } = {}) {
  const targetId = String(slideId || '').trim();
  if (!targetId) return { ok: false, reason: 'missing_slide_id' };

  const slides = Array.isArray(presentation?.slides) ? presentation.slides : [];
  const current = slides.find((s) => s && typeof s === 'object' && s.id === targetId);
  if (!current) return { ok: false, reason: 'slide_not_found' };

  const next = typeof notes === 'string' ? notes : String(notes ?? '');
  const before = typeof current.notes === 'string' ? current.notes : '';
  if (before === next) {
    // Idempotent no-op: skip the write so an autosave that fires without a
    // change doesn't bump the revision or broadcast a pointless refresh.
    return {
      ok: true,
      slideId: targetId,
      notes: next,
      revision: Number(presentation?.revision) || null,
      changed: false,
    };
  }

  const nextSlides = slides.map((s) =>
    s && typeof s === 'object' && s.id === targetId ? { ...s, notes: next } : s
  );

  // `{ slides }` and nothing else: the adapter's partial-write rule leaves every
  // column the caller did not name alone, so title, settings and the i18n
  // buffers survive untouched.
  const result = await updatePresentation(scope, presentation.id, { slides: nextSlides });
  if (!result) return { ok: false, reason: 'not_found' };
  if (result.ok === false)
    return { ok: false, reason: result.reason || 'write_failed', errors: result.errors };

  return {
    ok: true,
    slideId: targetId,
    notes: next,
    revision: Number(result.revision) || null,
    changed: true,
  };
}
