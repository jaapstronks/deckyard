/**
 * Re-derive the instance-bound content keys of a deck that is about to be
 * created.
 *
 * A slide type declares which of its content keys belong to *this* slide
 * instance rather than to its text — `instanceKeys` in
 * shared/slide-types/instance-keys.js, today `poll-slide.pollId` (`fresh-id`) and
 * `follow-invite-slide.presentationId` (`presentation-id`). The editor honours
 * that declaration on every copy path through `cloneSlidesForInsert()`. The two
 * server paths that also mint a deck full of slides someone else authored did
 * not:
 *
 * - `POST /api/presentations` with `slides[]` — the slide-library compose (both
 *   the sidebar and the creation view), and any agent or MCP client that posts
 *   a deck. A library item carrying a `pollId` handed every deck composed from
 *   it the *same* poll, so their live results ran together.
 * - duplicating a deck, which copied the poll id and the follow-invite's
 *   presentation id straight into the copy.
 *
 * Both now call this, so the declaration is honoured wherever a slide enters a
 * new deck instead of only in the editor.
 *
 * ## One value per slide, across every language
 *
 * A deck holds each slide once per i18n language version, and the versions of
 * one slide share an id because they *are* one slide. The rekeyed value has to
 * be shared for the same reason: a poll whose nl version and en-GB version hold
 * different `pollId`s is two polls that swap depending on the language the deck
 * happens to be showing. So the value is computed on first sight of a slide id
 * and copied into every later version of it.
 *
 * @see shared/slide-types/instance-keys.js — the declaration and its vocabulary.
 * @see client/lib/slide-authoring/clone-slides.js — the editor's half.
 */

import { getSlideType } from '../../../../shared/slide-types/registry.js';
import { applyInstanceKeyRekey } from '../../../../shared/slide-types/instance-keys.js';
import { cryptoUuid } from '../../../../shared/slide-types/helpers.js';

/**
 * Every slide list a deck holds: the top-level one plus one per i18n language
 * version. The same array can appear twice (the dominant version is usually
 * `pres.slides` itself) — harmless, the caller is idempotent per slide id.
 * @param {Object} pres
 * @returns {Array<Array<Object>>}
 */
function slideLists(pres) {
  const lists = [];
  if (Array.isArray(pres?.slides)) lists.push(pres.slides);
  const versions = pres?.i18n?.versions;
  if (versions && typeof versions === 'object') {
    for (const version of Object.values(versions)) {
      if (Array.isArray(version?.slides)) lists.push(version.slides);
    }
  }
  return lists;
}

/**
 * Apply every slide type's `instanceKeys` declaration across a prepared deck,
 * in place, before it is stored.
 *
 * @param {Object} pres - the deck being created, with its `id` already minted
 *   (a `presentation-id` key is rewritten to it) and its i18n versions built.
 * @returns {Object} the same deck
 */
export function rekeyNewDeckSlides(pres) {
  const presentationId = typeof pres?.id === 'string' ? pres.id : '';
  /** @type {Map<string, Record<string, string>>} slide id → rekeyed values */
  const valuesBySlideId = new Map();

  for (const list of slideLists(pres)) {
    for (const slide of list) {
      const def = getSlideType(slide?.type);
      const seen =
        typeof slide?.id === 'string' ? valuesBySlideId.get(slide.id) : null;
      const written = applyInstanceKeyRekey(slide, {
        def,
        presentationId,
        newId: cryptoUuid,
      });
      if (!written.length) continue;
      if (seen) {
        // A later language version of a slide already rekeyed: same slide, so
        // the same values, not the fresh ones just written.
        for (const key of written) slide.content[key] = seen[key];
      } else if (typeof slide?.id === 'string' && slide.id) {
        valuesBySlideId.set(
          slide.id,
          Object.fromEntries(written.map((key) => [key, slide.content[key]])),
        );
      }
    }
  }
  return pres;
}
