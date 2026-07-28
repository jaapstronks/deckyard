/**
 * The `runtime` facet: what the presenting session has to do for a slide type
 * beyond serving it.
 *
 * The second facet, and unlike `structure` it was not designed — it was
 * measured. Assertion 5 of the `structure` guardrail derived every module that
 * branches on three or more slide-type names and found nine of them writing out
 * the same four names (`poll-slide`, `likert-slide`, `likert-slider-slide`,
 * `feedback-slide`) to answer one question: *does this slide collect answers
 * from the audience?* None of the nine wanted to know which type it was. They
 * all wanted a capability the type did not declare, so each re-derived it, and
 * they had already drifted apart at the edges — the session storage covered
 * three of the four, the presenter's live set reached past them to
 * `follow-invite-slide`.
 *
 * ## The vocabulary
 *
 * - `static` — the session does nothing for it. The slide may still have
 *   client-side behaviour of its own (a lead-capture form that posts, a QR that
 *   refreshes): that is the slide's business, not the session's.
 * - `timed` — the presenter drives a clock on the slide. The timer state lives
 *   in the presenting window; the session neither holds nor aggregates it.
 * - `live` — the audience answers, and the session collects and aggregates
 *   those answers as state the presenter opens and closes.
 *
 * The line is deliberately drawn at *session state*, not at "has behaviour", so
 * the three edge cases fall out of the definition instead of being argued one
 * by one:
 *
 * - `countdown-slide` is `timed`, not `live`: a clock, no audience, no session.
 * - `lead-capture-slide` is `static`: it collects, but into permanent lead
 *   storage over its own endpoint, never into the session. Widening `live` to
 *   mean "collects something from a human" would drop it inside four submission
 *   guards that have no code path for it, one of them security-adjacent.
 * - `follow-invite-slide` is `static`: it renders the join code the session
 *   issued, which is a render input, not state the session keeps for the slide.
 *
 * What this facet is **not** is "does the type mount a client runtime". That
 * question has one consumer (`client/lib/slide-runtime/slide-render.js`, whose
 * three mounts are follow-invite, lead-capture and countdown) and cuts the set
 * differently. One near-miss axis, named here so the next reader does not have
 * to rediscover that it is a different question.
 *
 * ## The sub-declaration
 *
 * `live` alone does not retire the hand-rolled lists: five of the nine modules
 * also re-derived *which kind* of answer the slide collects, mapping four type
 * names onto the three protocol values the follow API already speaks
 * (`interaction.type` — `poll`, `likert`, `feedback`). So a `live` type also
 * declares its `interaction` kind. It is not a second facet: it is the contract
 * the `live` value implies, and it is meaningless on any other value.
 *
 * ## What it costs in truthfulness
 *
 * `structure` was the first facet because it is derivable: the field schema
 * already knows the shape, so a declaration that lies is detectable. `runtime`
 * is not derivable that way — nothing in the schema says the session aggregates
 * answers. Its guardrail is therefore built the other way round: the four live
 * types are the only types carrying a `question` field (a necessary, not a
 * sufficient, condition), and above all *no module may re-derive the live set
 * by hand* — the measurement that produced this facet, kept as a ceiling.
 *
 * @see docs/reference/slide-type-runtime.md
 * @see docs/reference/slide-type-structure.md
 */

import { SLIDE_TYPES } from './registry.js';

/**
 * The vocabulary. These three partition the current 38 types completely.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SLIDE_RUNTIMES = Object.freeze({
  /** The session does nothing for it beyond serving the slide. */
  static: 'The session does nothing for it.',
  /** A presenter-driven clock; state is local to the presenting window. */
  timed: 'A presenter-driven clock, local to the presenting window.',
  /** The audience answers; the session collects and aggregates. */
  live: 'The audience answers; the session collects and aggregates.',
});

/** @type {ReadonlyArray<string>} */
export const SLIDE_RUNTIME_NAMES = Object.freeze(Object.keys(SLIDE_RUNTIMES));

/**
 * What kind of answer a `live` type collects. These are the values the follow
 * API already puts on the wire as `interaction.type`, so this declaration names
 * an existing protocol rather than inventing one.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const LIVE_INTERACTIONS = Object.freeze({
  /** One choice out of a short option list. */
  poll: 'One choice out of a short option list.',
  /** A point on a scale, whether drawn as buttons or as a slider. */
  likert: 'A point on a scale.',
  /** Free text. */
  feedback: 'Free text.',
});

/** @type {ReadonlyArray<string>} */
export const LIVE_INTERACTION_NAMES = Object.freeze(Object.keys(LIVE_INTERACTIONS));

/**
 * Whether a value is a declared runtime.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSlideRuntime(value) {
  return typeof value === 'string' && Object.hasOwn(SLIDE_RUNTIMES, value);
}

/**
 * Whether a value is a declared live-interaction kind.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isLiveInteraction(value) {
  return typeof value === 'string' && Object.hasOwn(LIVE_INTERACTIONS, value);
}

/**
 * A slide type definition's declared runtime, or `''` when it declares none.
 * @param {any} def - a slide-type definition
 * @returns {string}
 */
export function slideRuntime(def) {
  const r = def?.runtime;
  return isSlideRuntime(r) ? r : '';
}

/**
 * A slide type definition's declared live-interaction kind, or `''`.
 *
 * Only meaningful on a `live` type; the guardrail asserts that no other type
 * carries one.
 *
 * @param {any} def - a slide-type definition
 * @returns {string}
 */
export function slideLiveInteraction(def) {
  const i = def?.interaction;
  return isLiveInteraction(i) ? i : '';
}

/**
 * Whether slides of this type collect answers the session aggregates.
 *
 * This is the predicate the nine modules wanted. Reads through the registry, so
 * a fork that overrides a core type by name gets its own answer — the same seam
 * `CUSTOM_SLIDE_TYPE_NAMES` opens everywhere else.
 *
 * @param {string} slideType - a slide type name
 * @returns {boolean}
 */
export function isLiveSlideType(slideType) {
  return slideRuntime(SLIDE_TYPES[slideType]) === 'live';
}

/**
 * The kind of answer a live slide type collects (`poll` / `likert` /
 * `feedback`), or `''` when the type is not live.
 *
 * The pair with `isLiveSlideType` covers every hand-rolled list the facet
 * replaced: the guard ("may this slide be submitted to?") and the dispatch
 * ("which widget, which aggregate, which payload shape?").
 *
 * @param {string} slideType - a slide type name
 * @returns {string}
 */
export function liveInteractionKind(slideType) {
  const def = SLIDE_TYPES[slideType];
  return slideRuntime(def) === 'live' ? slideLiveInteraction(def) : '';
}

/**
 * Every registered type that declares `runtime: 'live'`.
 *
 * A function rather than a constant: the registry applies fork overrides at
 * load time, and a snapshot taken at import time would freeze the core answer
 * before a custom type could change it.
 *
 * @returns {string[]}
 */
export function liveSlideTypeNames() {
  return Object.keys(SLIDE_TYPES).filter((name) => isLiveSlideType(name));
}
