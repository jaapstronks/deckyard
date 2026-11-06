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
 *   untouched (at most one debounce window stale), never clobbered. A field
 *   the validation refuses keeps its stored value in the JSON (inside a list,
 *   a refused item value is left out of its item, and a list refused as a
 *   list keeps the stored list of its field), and everything
 *   else in the store is written: the binary is a cache that a write from
 *   outside the doc deletes, so holding back more would risk losing it.
 *   Every peer is told which fields stay out (`shared/collab/refused-fields.js`):
 *   the store broadcasts the set when it changes, and mount.js sends it to
 *   each new connection, so the editor can say so where the save state lives.
 *
 * Dependencies are injectable for tests; production wiring is
 * `createCollabPersistence({ repoRoot })` from mount.js, gated by
 * COLLAB_LIVE_EDITS.
 */
import {
  withContentWrite,
  assertCurrentCustomFields,
  contentSlides,
} from '../storage/content-write.js';

import { isDeepStrictEqual } from 'node:util';
import * as YDefault from 'yjs';
import { deckYdocCodec } from './deck-doc.js';
import {
  encodeRefusedFields,
  refusedFieldsForPeers,
} from '../../shared/collab/refused-fields.js';
import { presentationIdFromDocumentName } from './auth.js';
import {
  getPresentation as defaultGetPresentation,
  updatePresentation as defaultUpdatePresentation,
} from '../storage/presentations/index.js';
import {
  getYDocState as defaultGetYDocState,
  setYDocState as defaultSetYDocState,
} from '../storage/presentations/index.js';
import { singleOrganizationScope } from '../storage/scope.js';
import { holdBackRefusedSlideFields } from '../services/slide-field-validation.js';
import { migratePresentation } from '../../shared/slide-types/schema-version.js';
import { canonicalJson } from '../../shared/slide-fingerprint.js';

/**
 * A deck as far as a store could change it. The doc's envelope carries the
 * revision and modification stamp of when it was last applied, which a write
 * moves on without the doc hearing of it, and a projection adds an empty `notes`
 * to a slide that has none.
 * @param {Object} pres
 * @returns {string} Canonical JSON: a stored date and its string compare equal.
 */
function writtenContent(pres) {
  const { revision, modified, updatedBy, ...content } = pres;
  const slidesOf = (slides) =>
    Array.isArray(slides)
      ? slides.map(({ notes, ...slide }) =>
          notes ? { ...slide, notes } : slide,
        )
      : slides;
  content.slides = slidesOf(pres.slides);
  if (pres.i18n?.versions) {
    content.i18n = {
      ...pres.i18n,
      versions: Object.fromEntries(
        Object.entries(pres.i18n.versions).map(([lang, version]) => [
          lang,
          { ...version, slides: slidesOf(version?.slides) },
        ]),
      ),
    };
  }
  return canonicalJson(JSON.parse(JSON.stringify(content)));
}

/**
 * Create the Hocuspocus persistence hooks.
 *
 * @param {Object} options
 * @param {string} options.repoRoot
 * @param {(documentName: string) => Object} [options.documentScope] - Storage scope
 *   for this document. The hooks run outside any request, so the organization is
 *   recorded at connect time by mount.js (which has the authorized deck) and read
 *   back here. Defaults to the deck's own organization for standalone use.
 * @param {Object} [options.deps] - Test seam: override storage/codec/Y/log
 * @returns {{onLoadDocument: Function, onStoreDocument: Function,
 *   afterUnloadDocument: Function}}
 */
export function createCollabPersistence({
  repoRoot,
  documentScope,
  deps = {},
}) {
  /** Organization per open document, learned on the first (bootstrap) read. */
  const documentOrganizations = new Map();
  /** The values each open document has refused and logged, per document. */
  const loggedRefusals = new Map();
  /** The encoded refused-fields message each open document last announced. */
  const announcedRefusals = new Map();

  /**
   * The storage scope for one collab document. Preferred source is the
   * organization mount.js recorded when it authorized the connection; the
   * bootstrap read fills it in as a backstop. A deck with no organization at all
   * predates the Postgres migration, which multi-organization mode refuses outright — so falling
   * back to the single organization there is exact, and throws if there ever is
   * more than one.
   */
  function storageScopeFor(documentName) {
    const base = documentScope ? documentScope(documentName) : {};
    const organizationId =
      base.organizationId || documentOrganizations.get(documentName) || null;
    return organizationId
      ? { ...base, repoRoot, organizationId }
      : singleOrganizationScope(repoRoot, 'collab document persistence');
  }
  const {
    Y = YDefault,
    codec = deckYdocCodec,
    getPresentation = defaultGetPresentation,
    updatePresentation = defaultUpdatePresentation,
    getYDocState = defaultGetYDocState,
    setYDocState = defaultSetYDocState,
    log = console,
  } = deps;

  /**
   * One line per refused value, not per store: a refused value stays in the doc
   * and comes back on every store until a peer fixes it. A value shared by the
   * language versions is one value, and so is an item sub-field's value while
   * its list is reordered or grows: the key is the slide, the field, the
   * sub-field and the value, without the item index. A list refused as a list
   * is keyed on its errors instead of the list, which every further edit in it
   * changes. Names where, never the value.
   */
  function logRefusals(documentName, id, refused) {
    const seen = loggedRefusals.get(documentName);
    const current = new Set();
    for (const { slideId, field, path = [], kind, errors, value } of refused) {
      const subField = path.filter((step) => typeof step === 'string');
      const key = canonicalJson([
        slideId,
        field,
        subField,
        kind === 'list' ? { errors } : { value },
      ]);
      if (!current.has(key) && !seen?.has(key)) {
        const where = path.length
          ? `field ${JSON.stringify(field)} item ${path
              .map((step) =>
                typeof step === 'number' ? `[${step}]` : `.${step}`,
              )
              .join('')}`
          : `field ${JSON.stringify(field)}`;
        log.warn(
          `[collab] ${id}: ${where} of slide ${JSON.stringify(slideId)} ` +
            `stays out of the deck JSON: ${errors.join('; ')}`,
        );
      }
      current.add(key);
    }
    if (current.size) loggedRefusals.set(documentName, current);
    else loggedRefusals.delete(documentName);
  }

  /**
   * Tell every peer of the document which fields this store held back, when
   * that set differs from the last one announced. A Y.Doc without the
   * Hocuspocus channel (a test, a direct call) is told nothing.
   */
  function announceRefusals(documentName, document, refused) {
    const message = encodeRefusedFields(refusedFieldsForPeers(refused));
    const empty = encodeRefusedFields([]);
    if (message === (announcedRefusals.get(documentName) ?? empty)) return;
    if (message === empty) announcedRefusals.delete(documentName);
    else announcedRefusals.set(documentName, message);
    document.broadcastStateless?.(message);
  }

  /**
   * What a loaded binary holds that the deck JSON refused, announced like a
   * store would. Telling is best effort: a failure here never fails the load.
   */
  async function recallRefusals(documentName, document, id, projected) {
    try {
      const storageScope = storageScopeFor(documentName);
      const current = await getPresentation(storageScope, id);
      if (!current) return;
      const held = await holdBackRefusedSlideFields(
        storageScope,
        current,
        projected,
      );
      announceRefusals(documentName, document, held.refused);
    } catch (err) {
      log.warn(
        `[collab] could not check ${id} for refused fields on load:`,
        err?.message || err,
      );
    }
  }

  /**
   * Send a new connection the fields its document currently holds back, also
   * when there are none: a reconnecting editor may still show an older set.
   * @param {{sendStateless: Function}} connection
   * @param {string} documentName
   */
  function sendRefusedFields(connection, documentName) {
    connection.sendStateless(
      announcedRefusals.get(documentName) ?? encodeRefusedFields([]),
    );
  }

  /** A doc is ours once bootstrap/load populated meta (guards empty docs). */
  function isPopulated(document) {
    return document.getMap('meta').get('extra') !== undefined;
  }

  async function onLoadDocument({ documentName, document }) {
    const id = presentationIdFromDocumentName(documentName);
    if (!id) return document;

    return withContentWrite(storageScopeFor(documentName), async () => {
      const stored = await getYDocState(storageScopeFor(documentName), id);
      if (stored instanceof Uint8Array && stored.length > 0) {
        Y.applyUpdate(document, stored, 'collab-load');
        // Create the shared container before any peers connect: two clients
        // initializing a nested Y.Map independently would compete for its slot.
        // This adds no records or inferred translation history.
        codec.ensureTranslationSources(document);
        // A binary can predate any canonical shape fold, just like the JSON.
        // Normalize its projection through the same funnel before peers see it,
        // then apply only the diff so existing collaborative text identities and
        // translation provenance survive (B800).
        const before = codec.projectDocToPresentation(document);
        const canonical = migratePresentation(structuredClone(before));
        if (!isDeepStrictEqual(before, canonical)) {
          codec.applyPresentationToDoc(canonical, document, { base: before });
          await setYDocState(
            storageScopeFor(documentName),
            id,
            Y.encodeStateAsUpdate(document),
          );
        }
        // A refused value outlives an unload in the binary: the first peer
        // hears of it on connect, not only after the next store.
        await recallRefusals(documentName, document, id, canonical);
        return document;
      }

      // The connection was authorized in onConnect, which is where a deck the user
      // may not read is rejected; this read is addressed by that authorization.
      const pres = await getPresentation(
        {
          ...storageScopeFor(documentName),
          crossOrganization:
            'collab document load: the connection was authorized in onConnect',
        },
        id,
      );
      if (!pres) return document; // authz already rejected unknown decks
      if (pres.organizationId)
        documentOrganizations.set(documentName, pres.organizationId);

      const { warnings } = codec.bootstrapPresentationToDoc(pres, document);
      if (warnings.length) {
        log.warn(
          `[collab] bootstrap of ${id} normalized diverged language versions (${warnings.length} warning(s)):\n` +
            warnings.map((w) => `  - ${w}`).join('\n'),
        );
      }

      // Persist the bootstrap immediately so later opens load the doc binary
      // instead of re-bootstrapping (and re-normalizing) from JSON.
      try {
        await setYDocState(
          storageScopeFor(documentName),
          id,
          Y.encodeStateAsUpdate(document),
        );
      } catch (err) {
        log.error(
          `[collab] failed to store bootstrap state for ${id}:`,
          err?.message || err,
        );
      }
      return document;
    });
  }

  /** Drop the per-document organization when Hocuspocus unloads the doc. */
  function afterUnloadDocument({ documentName }) {
    documentOrganizations.delete(documentName);
    loggedRefusals.delete(documentName);
    announcedRefusals.delete(documentName);
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

    return withContentWrite(storageScopeFor(documentName), async () => {
      // Capture both representations synchronously before any await. Peer edits
      // can change the live doc while registry/storage queries are pending;
      // those edits remain in the doc for the next store, never in this pair.
      const projectedSnapshot = codec.projectDocToPresentation(document);
      const binarySnapshot = Y.encodeStateAsUpdate(document);
      try {
        await assertCurrentCustomFields(
          storageScopeFor(documentName),
          contentSlides(projectedSnapshot),
        );
      } catch (err) {
        log.error(
          `[collab] refusing obsolete custom fields for ${id}:`,
          err?.message || err,
        );
        return;
      }
      try {
        await setYDocState(storageScopeFor(documentName), id, binarySnapshot);
      } catch (err) {
        // Do NOT fall through to the JSON write. If the binary store failed but
        // the JSON write then succeeded, the stored binary would be OLDER than
        // the JSON, and nothing invalidates it (collab-reason saves never delete
        // the binary) — the next collab open would load the stale binary and
        // revert the newer JSON on its first store. Bailing keeps the pair
        // consistent: the JSON is at most one debounce window stale and
        // self-heals on the next (retried) store.
        log.error(
          `[collab] failed to store doc binary for ${id}; skipping the JSON write ` +
            'this cycle to keep binary/JSON consistent (retries next store):',
          err?.message || err,
        );
        return;
      }

      // Serialize to the legacy JSON through the facade. The doc is the merge,
      // so no expectedRevision (no conflict check); locks don't apply to
      // collab-managed saves.
      try {
        // Through the read funnel first: a doc binary stored before a schema
        // step still holds the old shapes, and the write seam refuses some of
        // them (an unoffered text style, B464). Folding here is what every read
        // of the stored JSON does too.
        const projected = migratePresentation(projectedSnapshot);
        const storageScope = storageScopeFor(documentName);
        const current = await getPresentation(storageScope, id);
        // The doc is what peers typed, so it passes the same field validation
        // as an editor save before it becomes the deck JSON that shared and
        // published surfaces read, field by field: a refused value stays in the
        // binary and out of the JSON, and the rest of this store is written.
        let deck = projected;
        if (current) {
          const held = await holdBackRefusedSlideFields(
            storageScope,
            current,
            projected,
          );
          deck = held.deck;
          logRefusals(documentName, id, held.refused);
          announceRefusals(documentName, document, held.refused);
        }
        // Skip the JSON write when what would be written equals the stored deck
        // — notably right after the server-as-collaborator seam applied a fresh
        // server save to the doc (live-apply.js flushes this hook on
        // disconnect), or when only a refused field changed. Storing anyway
        // would bump the revision and fire SSE for a byte-identical deck.
        if (current && writtenContent(deck) === writtenContent(current)) return;
        const result = await updatePresentation(storageScope, id, deck, {
          bypassLockCheck: true,
          reason: 'collab',
        });
        if (!result || result.ok === false) {
          log.error(
            `[collab] serializing ${id} to JSON was rejected (${result?.reason || 'unknown'}); ` +
              'doc binary kept, JSON left as-is (at most one debounce window stale)',
          );
        }
      } catch (err) {
        log.error(
          `[collab] serializing ${id} to JSON failed; doc binary kept, JSON left as-is:`,
          err?.message || err,
        );
      }
    });
  }

  return {
    onLoadDocument,
    onStoreDocument,
    afterUnloadDocument,
    sendRefusedFields,
  };
}
