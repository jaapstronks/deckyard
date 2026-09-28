/**
 * Sandbox example presentations.
 *
 * A small set of ready-made demo decks (stored as deckyard.deck JSON under
 * server/sandbox-examples/) that a first-time sandbox visitor can open and edit
 * — the fastest way to try the editor without building a deck from scratch.
 *
 * These are templates: the sandbox Home lists them, and instantiating one goes
 * through the normal /api/presentations/import/json path so the guest gets
 * their own editable copy. Nothing here writes to storage.
 *
 * An example file names its theme by seed slug (`editorial`), because a
 * record UUID differs per installation and cannot be committed. That slug is
 * deployment config, resolved here to the seed's record UUID before anything
 * reaches the browser (D237): the preview reference and `deck.theme` both
 * carry the UUID, so the import route and the client loader only ever see the
 * one spelling they accept.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveSeedThemeSlug } from '../storage/settings.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sandbox-examples');

const EXAMPLES_DIRNAME = path.join('server', 'sandbox-examples');

/** Stable display order (by id) so the shelf never reshuffles between loads. */
const ORDER = ['meet-deckyard', 'acme-quarterly', 'ice-cream-cart'];

function orderIndex(id) {
  const i = ORDER.indexOf(id);
  return i === -1 ? ORDER.length : i;
}

/**
 * Derive a one-line description from the deck: the first title slide's
 * subheading, else the first content slide's title. Empty string if neither.
 * @param {object} deck
 * @returns {string}
 */
function deriveDescription(deck) {
  const slides = Array.isArray(deck?.slides) ? deck.slides : [];
  const title = slides.find((s) => s?.type === 'title-slide');
  const sub = String(title?.content?.subheading || '').trim();
  if (sub) return sub;
  const content = slides.find((s) => s?.type === 'content-slide');
  return String(content?.content?.title || '').trim();
}

/**
 * Read every example deck from disk, newest-format-first sorted by ORDER.
 * A file that fails to parse, or whose theme slug names no seed, is skipped
 * rather than breaking the whole list.
 * @param {string} repoRoot
 * @returns {Promise<Array<{id:string,title:string,description:string,theme:string,slideCount:number,deck:object}>>}
 */
export async function listSandboxExamples(repoRoot) {
  const dir = path.join(repoRoot, EXAMPLES_DIRNAME);
  let files;
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const jsonFiles = files.filter((f) => f.toLowerCase().endsWith('.json'));

  const examples = [];
  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      const example = JSON.parse(raw);
      const id = file.replace(/\.json$/i, '');
      const theme = await resolveSeedThemeSlug(example?.theme);
      if (!theme) {
        log.warn(`Sandbox example ${id} names no seed theme`, {
          theme: example?.theme,
        });
        continue;
      }
      const deck = { ...example, theme };
      examples.push({
        id,
        title: String(deck.title || id),
        description: deriveDescription(deck),
        theme,
        slideCount: Array.isArray(deck.slides) ? deck.slides.length : 0,
        deck,
      });
    } catch {
      // Skip an unreadable/invalid example; the others still load.
    }
  }

  examples.sort(
    (a, b) => orderIndex(a.id) - orderIndex(b.id) || a.id.localeCompare(b.id),
  );
  return examples;
}
