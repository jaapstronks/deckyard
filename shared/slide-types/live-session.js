/**
 * The two facets that tie a slide type to the live session.
 *
 * - `liveOnly: true` — the slide only means something while a session is
 *   running, so every output that outlives the session leaves it out: the
 *   reader, the exports, the published view, the preview image a published or
 *   shared deck is rendered from. Read through {@link isLiveOnlySlideType}.
 * - `liveInvite: true` — the slide is the audience's way *into* the session:
 *   it renders the join code the session issued. That role has four readers,
 *   and they ask it here instead of knowing the type's name: the editor
 *   suggests one when an interactive (`runtime: 'live'`) slide lands in a deck
 *   without one and inserts this type; the presenter hands it the join codes
 *   and skips it when its author switched it off in place (`content.enabled`,
 *   the one content key the invite's own form owns); the follow view shows the
 *   joined-confirmation in its place; the save path normalizes its content.
 *   Read through {@link isLiveInviteSlideType} and {@link liveInviteSlideType}.
 *
 * Both used to be answered by the type's name, `follow-invite-slide`, in a
 * dozen modules (B413). A declaration lets a fork put its own type in the role
 * and lets every module ask the role instead of the name. An invite is
 * live-only by definition — an invitation into a session nothing can start is
 * noise in a PDF — so `liveInvite` implies `liveOnly`; the validator warns
 * when a definition says otherwise and the guardrail test pins it for core.
 *
 * Name-based through the registry, like `isLiveSlideType()` in `./runtime.js`:
 * a fork that overrides a core type by name gets its own answer.
 */

import { SLIDE_TYPES, getSlideType } from './registry.js';

/**
 * Whether slides of this type only mean something while a session is live.
 *
 * @param {string} slideType - a slide type name (any spelling `getSlideType` accepts)
 * @param {Record<string, object>} [slideTypes] - registry to resolve against
 * @returns {boolean}
 */
export function isLiveOnlySlideType(slideType, slideTypes = SLIDE_TYPES) {
  return getSlideType(slideType, slideTypes)?.liveOnly === true;
}

/**
 * Whether slides of this type are the audience's way into the session.
 *
 * @param {string} slideType - a slide type name (any spelling `getSlideType` accepts)
 * @param {Record<string, object>} [slideTypes] - registry to resolve against
 * @returns {boolean}
 */
export function isLiveInviteSlideType(slideType, slideTypes = SLIDE_TYPES) {
  return getSlideType(slideType, slideTypes)?.liveInvite === true;
}

/**
 * The registered type that declares `liveInvite: true` — what the editor
 * inserts when it suggests an invite — or `''` when this installation has
 * none, in which case there is nothing to suggest.
 *
 * A function rather than a constant, for the same reason `liveSlideTypeNames()`
 * is one: the registry applies fork overrides at load time.
 *
 * @param {Record<string, object>} [slideTypes] - registry to enumerate
 * @returns {string} a slide type name, or `''`
 */
export function liveInviteSlideType(slideTypes = SLIDE_TYPES) {
  return (
    Object.keys(slideTypes).find(
      (name) => slideTypes[name]?.liveInvite === true,
    ) || ''
  );
}
