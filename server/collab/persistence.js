/**
 * Y.Doc persistence hooks for the collab endpoint (phase 2, ADR 001 §5).
 *
 * While a deck is open collaboratively the Y.Doc is the live source of
 * truth; the deck JSON stays the durable format:
 *
 * - onLoadDocument: load the stored doc binary, or bootstrap the doc from
 *   the deck JSON on first collab open (bootstrap warnings are logged
 *   loudly — they mean the deck's language versions had diverged and were
 *   normalized to the dominant structure).
 * - onStoreDocument (debounced by Hocuspocus, plus flushed on last client
 *   disconnect): store the doc binary AND serialize back to deck JSON
 *   through the existing updatePresentation facade (no expectedRevision —
 *   the doc IS the merge — but validation, normalization, cache
 *   invalidation, deckUpdated SSE and throttled auto-snapshots all apply).
 *   If serialization fails, the binary is kept and the JSON is left
 *   untouched (at most one debounce window stale), never clobbered.
 *
 * Dependencies are injectable for tests; production wiring is
 * `createCollabPersistence({ repoRoot })` from mount.js, gated by
 * COLLAB_LIVE_EDITS.
 */

import * as YDefault from 'yjs';
import { deckYdocCodec } from './deck-doc.js';
import { presentationIdFromDocumentName } from './auth.js';
import {
  getPresentation as defaultGetPresentation,
  updatePresentation as defaultUpdatePresentation,
} from '../storage/presentations.js';
import {
  getYDocState as defaultGetYDocState,
  setYDocState as defaultSetYDocState,
} from '../storage/presentation-ydocs.js';

/**
 * Create the Hocuspocus persistence hooks.
 *
 * @param {Object} options
 * @param {string} options.repoRoot
 * @param {Object} [options.deps] - Test seam: override storage/codec/Y/log
 * @returns {{onLoadDocument: Function, onStoreDocument: Function}}
 */
export function createCollabPersistence({ repoRoot, deps = {} }) {
  const {
    Y = YDefault,
    codec = deckYdocCodec,
    getPresentation = defaultGetPresentation,
    updatePresentation = defaultUpdatePresentation,
    getYDocState = defaultGetYDocState,
    setYDocState = defaultSetYDocState,
    log = console,
  } = deps;

  /** A doc is ours once bootstrap/load populated meta (guards empty docs). */
  function isPopulated(document) {
    return document.getMap('meta').get('extra') !== undefined;
  }

  async function onLoadDocument({ documentName, document }) {
    const id = presentationIdFromDocumentName(documentName);
    if (!id) return document;

    const stored = await getYDocState(repoRoot, id);
    if (stored instanceof Uint8Array && stored.length > 0) {
      Y.applyUpdate(document, stored, 'collab-load');
      return document;
    }

    const pres = await getPresentation(repoRoot, id);
    if (!pres) return document; // authz already rejected unknown decks

    const { warnings } = codec.bootstrapPresentationToDoc(pres, document);
    if (warnings.length) {
      log.warn(
        `[collab] bootstrap of ${id} normalized diverged language versions (${warnings.length} warning(s)):\n` +
          warnings.map((w) => `  - ${w}`).join('\n')
      );
    }

    // Persist the bootstrap immediately so later opens load the doc binary
    // instead of re-bootstrapping (and re-normalizing) from JSON.
    try {
      await setYDocState(repoRoot, id, Y.encodeStateAsUpdate(document));
    } catch (err) {
      log.error(`[collab] failed to store bootstrap state for ${id}:`, err?.message || err);
    }
    return document;
  }

  async function onStoreDocument({ documentName, document }) {
    const id = presentationIdFromDocumentName(documentName);
    if (!id) return;

    // Never let an unpopulated doc overwrite a real deck: an empty doc can
    // only mean the load path was skipped or failed.
    if (!isPopulated(document)) {
      log.warn(`[collab] skipping store for ${id}: document has no deck state`);
      return;
    }

    try {
      await setYDocState(repoRoot, id, Y.encodeStateAsUpdate(document));
    } catch (err) {
      log.error(`[collab] failed to store doc binary for ${id}:`, err?.message || err);
    }

    // Serialize to the legacy JSON through the facade. The doc is the merge,
    // so no expectedRevision (no conflict check); locks don't apply to
    // collab-managed saves.
    try {
      const projected = codec.projectDocToPresentation(document);
      const result = await updatePresentation(repoRoot, id, projected, {
        bypassLockCheck: true,
        reason: 'collab',
      });
      if (!result || result.ok === false) {
        log.error(
          `[collab] serializing ${id} to JSON was rejected (${result?.reason || 'unknown'}); ` +
            'doc binary kept, JSON left as-is (at most one debounce window stale)'
        );
      }
    } catch (err) {
      log.error(
        `[collab] serializing ${id} to JSON failed; doc binary kept, JSON left as-is:`,
        err?.message || err
      );
    }
  }

  return { onLoadDocument, onStoreDocument };
}
