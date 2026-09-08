import calloutSlide from './types/callout-slide/index.js';
import chapterTitleSlide from './types/chapter-title-slide.js';
import contentSlide from './types/content-slide.js';
import iconCardGridSlide from './types/icon-card-grid-slide/index.js';
import imageSlide from './types/image-slide.js';
import imageTextSlide from './types/image-text-slide.js';
import listSlide from './types/list-slide.js';
import endSlide from './types/end-slide.js';
import payoffSlide from './types/payoff-slide.js';
import quoteSlide from './types/quote-slide.js';
import teamCardsSlide from './types/team-cards-slide.js';
import logoWallSlide from './types/logo-wall-slide.js';
import titleSlide from './types/title-slide.js';
import videoSlide from './types/video-slide.js';
import embedSlide from './types/embed-slide.js';
import countdownSlide from './types/countdown-slide.js';
import pollSlide from './types/poll-slide.js';
import likertSlide from './types/likert-slide.js';
import likertSliderSlide from './types/likert-slider-slide.js';
import followInviteSlide from './types/follow-invite-slide.js';
import chartSlide from './types/chart-slide.js';
import feedbackSlide from './types/feedback-slide.js';
import tableSlide from './types/table-slide.js';
import kpiMetricsSlide from './types/kpi-metrics-slide.js';
import textBlocksSlide from './types/text-blocks-slide.js';
import comparisonSlide from './types/comparison-slide.js';
import processSlide from './types/process-slide.js';
import timelineSlide from './types/timeline-slide.js';
import matrixSlide from './types/matrix-slide.js';
import funnelSlide from './types/funnel-slide.js';
import pyramidSlide from './types/pyramid-slide.js';
import cycleSlide from './types/cycle-slide.js';
import gallerySlide from './types/gallery-slide.js';
import customHtmlSlide from './types/custom-html-slide.js';
import { GLOBAL_SLIDE_FIELD_KEYS, composeSlideType } from './compose.js';
import { DEFAULT_THEME_ID } from '../constants/themes.js';
import {
  CORE_NAMESPACE,
  SLIDE_NAME_SUFFIX,
  canonicalTypeName,
  formatCanonicalId,
  isValidNamespace,
  tryParseTypeId,
} from './type-id.js';

// A fork namespace is either a kebab-safe label (`acme`) or a reverse-DNS
// authority (`nl.ciiic.slide`); anything else falls back to the generic
// `custom` namespace so a malformed declaration can't produce an invalid type
// id. Declaring an authority is what earns a fork a canonical reverse-DNS id
// instead of the slash form — see formatCanonicalId(). The grammar itself is
// type-id.js's (isValidNamespace); this file used to carry a second copy of the
// same regex.
const DEFAULT_CUSTOM_NAMESPACE = 'custom';

// Detect if we're running in Node.js (has process.versions.node)
const isNode = typeof process !== 'undefined' && process.versions?.node;

// The composition every registry entry goes through lives in `compose.js`, so
// that the DB-backed types in `buildMergedSlideTypes` can run the very same
// one (B240). A leaf module is also what lets the Settings builder read the
// injected key list without pulling all 33 core types into its bundle.
// Re-exported here because this is where consumers have always reached for it.
export { GLOBAL_SLIDE_FIELD_KEYS };

// Core slide types (always available in OSS version)
const CORE_SLIDE_TYPES = {
  'title-slide': titleSlide,
  'chapter-title-slide': chapterTitleSlide,
  'content-slide': contentSlide,
  'callout-slide': calloutSlide,
  'table-slide': tableSlide,
  'list-slide': listSlide,
  'kpi-metrics-slide': kpiMetricsSlide,
  'image-text-slide': imageTextSlide,
  'video-slide': videoSlide,
  'team-cards-slide': teamCardsSlide,
  'logo-wall-slide': logoWallSlide,
  'icon-card-grid-slide': iconCardGridSlide,
  'payoff-slide': payoffSlide,
  'quote-slide': quoteSlide,
  'image-slide': imageSlide,
  'embed-slide': embedSlide,
  'countdown-slide': countdownSlide,
  'poll-slide': pollSlide,
  'likert-slide': likertSlide,
  'likert-slider-slide': likertSliderSlide,
  'feedback-slide': feedbackSlide,
  'follow-invite-slide': followInviteSlide,
  'chart-slide': chartSlide,
  'text-blocks-slide': textBlocksSlide,
  'comparison-slide': comparisonSlide,
  'process-slide': processSlide,
  'timeline-slide': timelineSlide,
  'matrix-slide': matrixSlide,
  'funnel-slide': funnelSlide,
  'pyramid-slide': pyramidSlide,
  'cycle-slide': cycleSlide,
  'gallery-slide': gallerySlide,
  'custom-html-slide': customHtmlSlide,
  'end-slide': endSlide,
};

// Load custom slide types from /custom/slide-types/ directory (server-only)
// Custom types are loaded at startup and override core types if same name
// Browser builds skip this since they can't access the filesystem
let customTypes = {};
if (isNode) {
  const { loadCustomSlideTypes } = await import('./custom-loader.js');
  // The keys travel as an argument, not because the loader could not import
  // them (compose.js is a leaf), but because supplying them is a claim about
  // the definitions being checked: these are RAW, so a key from the list is a
  // shadow. A composed definition carries them legitimately and passes none.
  // See validate-definition.js.
  customTypes = await loadCustomSlideTypes({
    globalFieldKeys: GLOBAL_SLIDE_FIELD_KEYS,
  });
}

/**
 * Merge core and custom slide types with collision detection.
 *
 * A custom type may NOT silently shadow a core type: doing so by accident is
 * exactly how a fork ends up quietly replacing core behaviour. To replace a
 * core type on purpose, the custom definition must opt in with `override: true`
 * (optionally `overrides: 'core/<name>'` for documentation). Without the flag
 * the core type is kept and a prominent warning is logged, so the shadow is
 * never silent.
 *
 * @param {Record<string, object>} core
 * @param {Record<string, object>} custom
 * @returns {Record<string, object>}
 */
export function mergeSlideTypes(core, custom) {
  const merged = { ...core };
  for (const [name, def] of Object.entries(custom)) {
    const shadowsCore = Object.prototype.hasOwnProperty.call(core, name);
    if (shadowsCore && !def?.override) {
      console.warn(
        `[registry] Custom slide type "${name}" would shadow the core type ` +
          `"${name}" but does not declare "override: true" — keeping core. ` +
          `Rename the custom type, or set override:true to replace core on purpose.`,
      );
      continue; // core wins; the shadow is refused, not applied silently
    }
    if (shadowsCore) {
      // stderr for the same reason as the custom loader's banner: importing the
      // registry must not write to a tool's stdout.
      console.warn(
        `[registry] Custom slide type "${name}" intentionally overrides core (override:true).`,
      );
    }
    merged[name] = def;
  }
  return merged;
}

/**
 * The core names a custom map overrides (`override: true` on a name that also
 * exists in core). A shadow without the flag is refused by mergeSlideTypes(), so
 * it is NOT an override and is excluded here — the two functions read the same
 * rule. Pure and order-preserving (core order), so it is unit-testable with
 * synthetic maps the way mergeSlideTypes() is.
 *
 * @param {Record<string, object>} core
 * @param {Record<string, object>} custom
 * @returns {string[]}
 */
export function overriddenCoreNames(core, custom) {
  const c = custom && typeof custom === 'object' ? custom : {};
  return Object.keys(core).filter(
    (name) =>
      Object.prototype.hasOwnProperty.call(c, name) &&
      Boolean(c[name]?.override),
  );
}

// Merge core and custom types. Custom types are additive; a core-name collision
// is only honoured with an explicit override flag (see mergeSlideTypes).
const RAW_SLIDE_TYPES = mergeSlideTypes(CORE_SLIDE_TYPES, customTypes);

// Names of custom types that were REFUSED because they collided with core
// without an override flag. Kept so CUSTOM_SLIDE_TYPE_NAMES stays accurate
// (a refused type did not enter the registry).
const APPLIED_CUSTOM_NAMES = Object.keys(customTypes).filter(
  (name) =>
    !Object.prototype.hasOwnProperty.call(CORE_SLIDE_TYPES, name) ||
    customTypes[name]?.override,
);

export const SLIDE_TYPES = Object.fromEntries(
  Object.entries(RAW_SLIDE_TYPES).map(([type, def]) => [
    type,
    composeSlideType(type, def),
  ]),
);

/**
 * The core definitions by name — `SLIDE_TYPES` without the custom merge.
 *
 * The fork-stable counterpart of `CORE_SLIDE_TYPE_NAMES`, for tooling that
 * writes **tracked artifacts** from a definition: generated reference docs read
 * schemas here rather than from `SLIDE_TYPES`, so a fork that overrides a core
 * name (`override: true`) cannot make upstream's committed output depend on the
 * checkout — the same reason i18n extraction skips `CUSTOM_SLIDE_TYPE_NAMES`.
 *
 * Runtime consumers want `SLIDE_TYPES`: an override exists precisely to be
 * rendered, and reading core's def instead would ignore it.
 *
 * @type {Readonly<Record<string, Object>>}
 */
export const CORE_SLIDE_TYPE_DEFS = Object.freeze(
  Object.fromEntries(
    Object.entries(CORE_SLIDE_TYPES).map(([type, def]) => [
      type,
      composeSlideType(type, def),
    ]),
  ),
);

// Names of types that came from custom/slide-types/ AND actually entered the
// registry (a core-colliding type refused for lack of an override flag did
// not). Tooling that produces tracked artifacts (e.g. i18n extraction) skips
// these so a locally-installed fork customization can't leak into upstream files.
export const CUSTOM_SLIDE_TYPE_NAMES = APPLIED_CUSTOM_NAMES;

/**
 * Applied custom types whose name shadows a core type (`override: true`).
 *
 * These are the types with a split renderer between server and browser: the
 * server registry holds the fork's `renderHtml`, but the browser bundles core's
 * under the same name (`custom/slide-types/` is behind `isNode` and is not on
 * the static allowlist), so the client would draw core's markup for a slide the
 * server renders as the fork's. The client uses this list to route such a name
 * through server-side rendering instead — see `overriddenCoreNames()` for the
 * pure derivation and the render path's `needsServerRender()` for the consumer.
 * Empty in the OSS registry; non-empty only when a fork overrides a core name.
 * @type {string[]}
 */
export const OVERRIDDEN_CORE_SLIDE_TYPE_NAMES = overriddenCoreNames(
  CORE_SLIDE_TYPES,
  customTypes,
);

// The bare core type names, in registration order. This is the fork-stable
// count of built-in types: unlike `Object.keys(SLIDE_TYPES)`, it excludes any
// types a fork drops into `custom/slide-types/`, so tooling and docs that talk
// about "the built-in slide types" derive a number that does not shift by
// checkout (e.g. a fork carrying `ciiic-title-slide` would make SLIDE_TYPES 39).
export const CORE_SLIDE_TYPE_NAMES = Object.keys(CORE_SLIDE_TYPES);

// ---------------------------------------------------------------------------
// Slide-type identity (canonical reverse-DNS id) — see ./type-id.js.
//
// The registry key stays the bare local name so every existing
// `SLIDE_TYPES[slide.type]` lookup and stored `slide.type` keep working. The
// namespace/version is an ADDED identity layer exposed alongside the map, not
// baked into the def objects (so generated schema/docs/API output are
// unaffected).
// ---------------------------------------------------------------------------

/**
 * Structured identity for a registered type name.
 * Core types resolve to the `core` namespace; applied custom types take their
 * declared `namespace`/`version` (falling back to the `custom` namespace).
 * @param {string} name
 * @returns {import('./type-id.js').TypeId}
 */
function slideTypeIdentityFor(name) {
  const custom = customTypes[name];
  const isAppliedCustom = APPLIED_CUSTOM_NAMES.includes(name);
  if (custom && isAppliedCustom) {
    const declared =
      typeof custom.namespace === 'string' ? custom.namespace : '';
    const namespace = isValidNamespace(declared)
      ? declared
      : DEFAULT_CUSTOM_NAMESPACE;
    return {
      namespace,
      name,
      version: custom.version != null ? String(custom.version) : null,
    };
  }
  const coreDef = CORE_SLIDE_TYPES[name];
  return {
    namespace: CORE_NAMESPACE,
    name,
    version: coreDef?.version != null ? String(coreDef.version) : null,
  };
}

/**
 * Canonical id per registered type name — reverse-DNS
 * (`eu.deckyard.slide.title`), the form the format publishes.
 * @type {Record<string, string>}
 */
export const SLIDE_TYPE_IDS = Object.fromEntries(
  Object.keys(SLIDE_TYPES).map((name) => [
    name,
    formatCanonicalId(slideTypeIdentityFor(name)),
  ]),
);

/**
 * The canonical id for a registered type name, or undefined if unknown.
 * @param {string} name
 * @returns {string|undefined}
 */
export function getSlideTypeId(name) {
  return SLIDE_TYPE_IDS[name];
}

/**
 * The names a reference may be spelled as, most specific first: the name as
 * given, then the same name with the `-slide` suffix added or removed.
 *
 * One rule covers both directions because the suffix is exactly what separates
 * the canonical published name from the historical registry key, and a
 * reference may legitimately arrive in either spelling.
 *
 * @param {string} name
 * @returns {string[]}
 */
function typeNameCandidates(name) {
  const canonical = canonicalTypeName(name);
  if (canonical !== name) return [name, canonical];
  return [name, `${name}${SLIDE_NAME_SUFFIX}`];
}

/**
 * Resolve a slide-type reference to the REGISTRY KEY it names, or `''`.
 *
 * The format has one canonical spelling of `slides[].type` — the reverse-DNS id
 * (`eu.deckyard.slide.title`). This is the one place that folds every accepted
 * spelling back to a storage key, and the storage write-seam
 * (`normalizeSlides`) leans on it so nothing non-canonical is persisted:
 *
 * - `eu.deckyard.slide.title` — the canonical reverse-DNS id (suffix dropped).
 * - `title-slide` — the bare registry key, still what `slides[].type` stores.
 * - `core/title-slide`, `title-slide@2`, `acme/hero` — qualified forms.
 *
 * The bare key and the `core/…` form are pre-convergence residue, accepted as
 * beta-window input normalization rather than as format features — see
 * docs/reference/versioning.md § The beta stance.
 *
 * An exact registry hit always wins, so a fork that registers a literal `title`
 * keeps it even though core's `title-slide` also answers to that name.
 * Namespace and version stay advisory at resolution time — the registry key is
 * the local name, and load-time collision detection guarantees one definition
 * per name — so a qualified ref resolves by its `name` segment.
 *
 * @param {string} ref
 * @param {Record<string, object>} [slideTypes] - registry to resolve against.
 * @returns {string} the registry key, or `''` when nothing matches.
 */
export function resolveSlideTypeName(ref, slideTypes = SLIDE_TYPES) {
  if (typeof ref !== 'string' || !ref) return '';
  if (Object.prototype.hasOwnProperty.call(slideTypes, ref)) return ref;
  const id = tryParseTypeId(ref);
  if (!id) return '';
  for (const candidate of typeNameCandidates(id.name)) {
    if (Object.prototype.hasOwnProperty.call(slideTypes, candidate)) {
      return candidate;
    }
  }
  return '';
}

/**
 * Resolve a slide-type reference to its definition, in any of the spellings
 * {@link resolveSlideTypeName} accepts.
 *
 * @param {string} ref
 * @param {Record<string, object>} [slideTypes] - registry to resolve against
 *   (defaults to SLIDE_TYPES; pass a custom map through the same seam).
 * @returns {object|undefined}
 */
export function getSlideType(ref, slideTypes = SLIDE_TYPES) {
  const name = resolveSlideTypeName(ref, slideTypes);
  return name ? slideTypes[name] : undefined;
}

/**
 * The canonical reverse-DNS id a stored slide-type value publishes as, in any
 * accepted spelling. This is the read/export counterpart to
 * {@link resolveSlideTypeName}: writes fold every spelling down to the registry
 * key, reads and exports project that key back up to the one published id. The
 * pair is what makes the round-trip stable by construction — nothing
 * non-canonical leaves the boundary, and every accepted spelling folds back in.
 *
 * A value that names no registered type is returned unchanged, so an unknown or
 * foreign type still crosses the boundary intact rather than being dropped.
 *
 * @param {string} type
 * @returns {string} the canonical id, or the input verbatim when unresolvable.
 */
export function canonicalSlideType(type) {
  const key = resolveSlideTypeName(type);
  return (key && SLIDE_TYPE_IDS[key]) || type;
}

// Core themes included with the OSS version.
// Additional themes can be added via custom/themes/ directory.
// Note: Themes are discovered dynamically at runtime from /themes/*.json and /custom/themes/*.json
export const THEMES = [
  DEFAULT_THEME_ID,
  // Neutral, non-branded base themes covering the common archetypes. Every
  // built-in other than the default is listed by id here: this array is the
  // validation enum, so a theme missing from it is rejected on save even
  // though `themes/<id>.json` exists on disk.
  'amethyst',
  'corporate',
  'editorial',
  'playful',
  'midnight',
];
