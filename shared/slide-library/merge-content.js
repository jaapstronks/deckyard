/**
 * The language versions of a slide-library item after its base content changes.
 *
 * A library item stores its base-language content twice: as `content` and as
 * `i18n.versions[i18n.dominant].content`. The other versions hold the same
 * slide in another language. When the base changes, all of them have to follow
 * — the dominant version becomes the new content, and every other version
 * keeps its own prose on the new structure. Before D170 the edit modal patched
 * `content` alone, so a deck composed from an edited item got the old text.
 *
 * This is the server's job, not the client's (D170): every writer — the UI,
 * later an API or MCP client — goes through the same save, and a merge that
 * lives in one client is a merge the next client forgets.
 *
 * The rule is the one the deck save and the portable deck (D89) already
 * follow, through the same pair of functions: `contentTranslation` reads a
 * version's prose against the base, `applyContentTranslation` builds a full
 * version from base plus prose. Structure, images, layout and background come
 * from the base; prose stays with its language; an item added to the base is
 * empty in the other languages, never filled with base-language text. Items
 * are matched by path (index), like the deck save.
 *
 * @module shared/slide-library/merge-content
 */

import {
  applyContentTranslation,
  contentTranslation,
  textFieldSpecForType,
} from '../slide-types/text-fields.js';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * The `i18n` an item should store once `content` is its new base content.
 *
 * An item without `i18n.dominant` has no language versions to keep in step and
 * gets none added: its `i18n` comes back as it was. Keys this module does not
 * know — on `i18n` and on each version — are kept.
 *
 * @param {Object} opts
 * @param {string} opts.slideType - The item's slide type; decides which keys are prose
 * @param {Object} opts.content - The new base-language content
 * @param {Object} [opts.i18n] - The item's stored `i18n`
 * @param {Object} [opts.slideTypes] - Slide-type registry (forks/tests override)
 * @returns {Object} The `i18n` to store
 */
export function mergeLibraryI18n({ slideType, content, i18n, slideTypes }) {
  const current = isPlainObject(i18n) ? i18n : {};
  const dominant = current.dominant;
  if (typeof dominant !== 'string' || !dominant) return current;

  const spec = textFieldSpecForType(slideType, slideTypes);
  const versions = isPlainObject(current.versions) ? current.versions : {};
  const next = {};
  for (const [lang, version] of Object.entries(versions)) {
    const v = isPlainObject(version) ? version : {};
    next[lang] =
      lang === dominant
        ? { ...v, content: structuredClone(content) }
        : {
            ...v,
            content: applyContentTranslation(
              spec,
              content,
              contentTranslation(spec, content, v.content),
            ),
          };
  }
  if (!next[dominant]) next[dominant] = { content: structuredClone(content) };
  return { ...current, versions: next };
}
