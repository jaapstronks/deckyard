/**
 * Deck schema versioning + the single migration runner.
 *
 * Move 1b of the datamodel-purity track. Before this, stored decks carried no
 * schema version at all (`version: 1` existed only on the export wire format in
 * deck.js, never on the thing on disk), and backward-compatibility was handled
 * by scattered per-type "fold on edit / fall back on render" resolvers. This
 * module gives the durable deck a stamped `schemaVersion` and one ordered place
 * to migrate old shapes forward.
 *
 * Design (modelled on Jupyter nbformat): a deck declares `schemaVersion`; a
 * single `migratePresentation()` funnel upgrades any older deck to the current
 * in-memory shape via a chain of small, pure steps, so the rest of the engine
 * never branches on version. Migration runs at read time; the upgraded deck is
 * persisted on the next write (reads never write).
 */

/** The schema version every freshly written deck is stamped with. */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Ordered migration steps. `SCHEMA_MIGRATIONS[i]` migrates a deck FROM version
 * `i` TO version `i + 1` and must:
 *  - assume the deck is already at the source version;
 *  - be pure enough to run safely (it may mutate the passed object, which is a
 *    fresh parse from disk, and must return the deck);
 *  - never lose data.
 *
 * The invariant `SCHEMA_MIGRATIONS.length === CURRENT_SCHEMA_VERSION` is
 * enforced by tests, so bumping the version forces you to add a real step.
 *
 * @type {Array<(pres: any) => any>}
 */
export const SCHEMA_MIGRATIONS = [
  // v0 -> v1: baseline stamp. Decks predating schemaVersion are structurally
  // already v1-shaped; their legacy field quirks (bgImage/slideBgImage,
  // image-slide layout->fit, image-text image->images[]) are still handled by
  // the existing lazy per-type resolvers. This step introduces the version
  // without rewriting content. When a later change retires a lazy resolver, it
  // lands as a v1 -> v2 step that folds the shape once, here.
  (pres) => pres,
];

/**
 * The version a deck is currently in. Missing/invalid stamps are treated as
 * version 0 (pre-versioning).
 * @param {any} pres
 * @returns {number}
 */
export function schemaVersionOf(pres) {
  const v = pres == null ? NaN : Number(pres.schemaVersion);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

/**
 * Upgrade a deck to `CURRENT_SCHEMA_VERSION` in memory, running each ordered
 * migration step in turn. Idempotent: an already-current deck is returned with
 * only its stamp normalised. A deck from a *newer* version is left untouched
 * (we never downgrade); validation surfaces that separately.
 * @param {any} pres
 * @returns {any} the same object, migrated and stamped
 */
export function migratePresentation(pres) {
  if (!pres || typeof pres !== 'object') return pres;
  const from = schemaVersionOf(pres);
  if (from >= CURRENT_SCHEMA_VERSION) {
    // Already current, or ahead of us (a deck written by a newer build). Don't
    // downgrade; only normalise the stamp to a number when it is exactly current.
    if (from === CURRENT_SCHEMA_VERSION) pres.schemaVersion = CURRENT_SCHEMA_VERSION;
    return pres;
  }
  let out = pres;
  for (let v = from; v < CURRENT_SCHEMA_VERSION; v += 1) {
    const step = SCHEMA_MIGRATIONS[v];
    if (typeof step === 'function') out = step(out) || out;
  }
  out.schemaVersion = CURRENT_SCHEMA_VERSION;
  return out;
}
