/**
 * Server-as-collaborator seam (phase 2, step 4 — ADR 001 §6).
 *
 * When a deck's collab document is actively loaded (clients connected), a
 * server-side save that only landed in the JSON would be overwritten by the
 * next debounced collab store. This module closes that gap: the storage
 * facade calls `applyServerWriteToActiveDoc` AFTER a successful JSON store,
 * and the just-stored (validated, normalized) presentation is applied to the
 * live doc as a structural diff via Hocuspocus' direct connection.
 *
 * Store-first, doc-second — deliberately inverted from the ADR sketch
 * (doc-first): the JSON path runs every check (revision conflict, locks,
 * author-lock validation, size limits, schema validation) before anything
 * happens, so a rejected write can never corrupt the live doc, and callers
 * get the same response they get today.
 *
 * The apply itself is a THREE-WAY diff: the facade passes the deck JSON the
 * write was based on (`base`, the stored state just before this save), and
 * only what the caller actually changed vs that base produces ops. That
 * matters because the stored JSON runs up to one persistence debounce
 * (~2 s) behind the live doc — a two-way "incoming vs doc" diff would
 * revert every in-flight client edit of that window. With the base,
 * concurrent client edits on anything the caller didn't touch survive
 * (the doc is the merge — no locks, no revision check here).
 *
 * `DirectConnection.disconnect()` flushes the store hooks immediately
 * (collapsing the pending debounce): the doc binary is persisted right away
 * (no stale-binary crash window) and the JSON re-store is skipped by
 * persistence.js when the projection equals the just-stored JSON.
 *
 * The direct connection transacts with Hocuspocus' own `{source: 'local'}`
 * origin. Client undo managers track only their binder's local origin (and
 * remote updates arrive under the provider's origin anyway), so server
 * writes are never undoable by clients.
 */

import { isCollabLiveEditsEnabled } from '../config/features.js';
import { getActiveHocuspocus } from './mount.js';
import { deckYdocCodec } from './deck-doc.js';
import { COLLAB_DOC_PREFIX } from './auth.js';

/**
 * Apply a just-stored presentation to its actively loaded collab doc.
 * No-op (returns false) when live edits are off, collab isn't mounted, or
 * the deck has no loaded document — the caller then treats the save as a
 * cold write (binary invalidation) exactly as before.
 *
 * @param {string} id - Presentation id
 * @param {Object} storedPres - The stored presentation (facade result)
 * @param {Object} [opts] - { base } + test seams { hocuspocus, codec, log }
 * @param {Object|null} [opts.base] - Deck JSON as stored just before this
 *   save (what the caller's write was based on) — enables the three-way diff
 * @returns {Promise<boolean>} true when the write reached the live doc
 */
export async function applyServerWriteToActiveDoc(id, storedPres, opts = {}) {
  const {
    base = null,
    hocuspocus = getActiveHocuspocus(),
    codec = deckYdocCodec,
    log = console,
  } = opts;
  if (!isCollabLiveEditsEnabled()) return false;
  if (!hocuspocus || !storedPres || typeof storedPres !== 'object') return false;

  const documentName = `${COLLAB_DOC_PREFIX}${id}`;
  if (!hocuspocus.documents.has(documentName)) return false;

  // The facade may have attached transient validation warnings to the
  // result object; those are response metadata, not deck content.
  const pres = { ...storedPres };
  delete pres._warnings;

  const connection = await hocuspocus.openDirectConnection(documentName, {
    source: 'deckyard-server-write',
  });
  try {
    let applied = false;
    await connection.transact((document) => {
      // An unpopulated doc means onLoadDocument failed or was skipped;
      // applying would bypass the bootstrap path. Leave it alone.
      if (document.getMap('meta').get('extra') === undefined) {
        log.warn(`[collab] skipping live apply for ${id}: document has no deck state`);
        return;
      }
      const { warnings } = codec.applyPresentationToDoc(pres, document, { base });
      if (warnings.length) {
        log.warn(
          `[collab] live apply of ${id} normalized diverged language versions (${warnings.length} warning(s)):\n` +
            warnings.map((w) => `  - ${w}`).join('\n')
        );
      }
      applied = true;
    });
    return applied;
  } finally {
    // Flushes the store hooks immediately: binary persisted now, JSON
    // re-store skipped when nothing else changed (see persistence.js).
    await connection.disconnect();
  }
}
