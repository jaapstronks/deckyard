#!/usr/bin/env node

/**
 * Count the stored slides and slide-library items that are not yet in the
 * current schema shape - content the read funnel still has to fold on every
 * read, because nothing has written it back since (B286).
 *
 * The test is the funnel itself, not a second list of legacy keys: a stored
 * slide counts when `migratePresentation()` (for a deck) or
 * `migrateLibraryItem()` (for a library item) changes its content or type. So a
 * step appended to the ledger is covered here without touching this script.
 *
 * Why it is worth running on a fork: until B286 the library skipped the funnel
 * entirely, so an item saved before a shape change kept the old shape and
 * rendered it to nobody. Library items now migrate on read, but the row stays
 * old until the item is saved again; this shows how many there are, and which
 * decks still hold a slide in an old shape.
 *
 * Read-only. It writes nothing, and exits 0 whatever it finds - it is a
 * listing, not a gate. It exits 1 only when it cannot read the database.
 *
 * Usage:
 *   node scripts/scan-unmigrated-content.js      # Postgres, via .env
 *
 * Surfaces: presentations.slides / .i18n, slide_library.content / .i18n.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isCli } from './lib/is-cli.js';
import { loadDotEnv } from '../server/config/env.js';
import { createMigrationDb } from '../server/db/migrate.js';
import {
  migrateLibraryItem,
  migratePresentation,
} from '../shared/slide-types/schema-version.js';

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

/**
 * JSON with object keys sorted, so two equal values stringify equally whatever
 * order the jsonb column handed their keys back in.
 * @param {any} value
 * @returns {string}
 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** @param {any} slide */
const slideShape = (slide) =>
  stableJson({ type: slide?.type ?? null, content: slide?.content ?? null });

/**
 * The slides of a stored deck the funnel would still change, as
 * `{ lang, slideId, type }` (lang `null` for the top-level `slides`).
 * @param {{ slides?: any, i18n?: any }} deck
 * @returns {Array<{ lang: (string|null), slideId: (string|null), type: string }>}
 */
export function unmigratedDeckSlides(deck) {
  const lists = [[null, deck?.slides]];
  const versions = deck?.i18n?.versions;
  if (versions && typeof versions === 'object')
    for (const [lang, v] of Object.entries(versions))
      lists.push([lang, v?.slides]);

  const migrated = migratePresentation(
    structuredClone({ slides: deck?.slides, i18n: deck?.i18n }),
  );
  const out = [];
  for (const [lang, slides] of lists) {
    if (!Array.isArray(slides)) continue;
    const after =
      lang === null ? migrated.slides : migrated.i18n?.versions?.[lang]?.slides;
    slides.forEach((slide, i) => {
      if (slideShape(slide) === slideShape(after?.[i])) return;
      out.push({
        lang,
        slideId: typeof slide?.id === 'string' ? slide.id : null,
        type: String(slide?.type ?? ''),
      });
    });
  }
  return out;
}

/**
 * Whether a stored slide-library item is still in an old shape.
 * @param {{ slideType?: string, content?: any, i18n?: any }} item
 * @returns {boolean}
 */
export function isUnmigratedLibraryItem(item) {
  const before = stableJson({
    slideType: item?.slideType ?? null,
    content: item?.content ?? null,
    i18n: item?.i18n ?? null,
  });
  const after = migrateLibraryItem(
    structuredClone({
      slideType: item?.slideType,
      content: item?.content,
      i18n: item?.i18n,
    }),
  );
  return (
    before !==
    stableJson({
      slideType: after?.slideType ?? null,
      content: after?.content ?? null,
      i18n: after?.i18n ?? null,
    })
  );
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
async function scanPostgres(db) {
  const decks = await db
    .selectFrom('presentations')
    .select(['id', 'title', 'slides', 'i18n'])
    .execute();

  let slideHits = 0;
  let deckHits = 0;
  console.log('Decks with slides in an old shape:\n');
  for (const row of decks) {
    const hits = unmigratedDeckSlides(row);
    if (!hits.length) continue;
    deckHits += 1;
    slideHits += hits.length;
    const types = [...new Set(hits.map((h) => h.type))].join(', ');
    console.log(
      `  ${row.id}  ${hits.length} slide(s)  [${types}]  ${row.title ?? ''}`,
    );
  }
  if (!deckHits) console.log('  (none)');

  const library = await db
    .selectFrom('slide_library')
    .select(['id', 'name', 'shelf', 'slide_type', 'content', 'i18n'])
    .execute();

  let libraryHits = 0;
  console.log('\nSlide-library items in an old shape:\n');
  for (const row of library) {
    const item = {
      slideType: row.slide_type,
      content: row.content || {},
      i18n: row.i18n || {},
    };
    if (!isUnmigratedLibraryItem(item)) continue;
    libraryHits += 1;
    console.log(
      `  ${row.id}  ${row.shelf}  [${row.slide_type}]  ${row.name ?? ''}`,
    );
  }
  if (!libraryHits) console.log('  (none)');

  console.log(
    `\n${deckHits} of ${decks.length} decks (${slideHits} slides), ` +
      `${libraryHits} of ${library.length} library items.`,
  );
}

async function main() {
  await loadDotEnv(REPO_ROOT);
  const db = await createMigrationDb();
  try {
    await scanPostgres(db);
  } finally {
    await db.destroy();
  }
}

// Only run as a CLI; importing the module (tests) must not touch any store.
if (isCli(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
