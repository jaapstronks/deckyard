/**
 * Base prompt registry.
 *
 * Re-exports every OSS-default prompt builder under a flat, stable name. These
 * names are the override keys a fork uses in `custom/ai/prompts.js`: export a
 * function under the same name to replace the base builder (see
 * `../custom-loader.js` and `../index.js`).
 *
 * Keep the names here in sync with the builders the pipeline calls through
 * `prompts.<name>(...)`.
 */

export { buildPhase1SystemPrompt, buildPhase1UserPrompt } from './outline.js';
// `buildThemeContextSection` is deliberately NOT re-exported: it's an internal
// helper that `buildPhase2SystemPrompt` calls as a module-local sibling, not
// through the resolved `prompts` registry (base modules can't import `prompts`
// without a cycle). Advertising it as an override name would accept and log a
// fork's override while never actually invoking it. Forks tune the theme
// section by overriding the enclosing `buildPhase2SystemPrompt` instead.
export { buildPhase2SystemPrompt, buildPhase2UserPrompt } from './refine-slides.js';
export { buildRevisionSystemPrompt, buildRevisionUserPrompt } from './revise-outline.js';
export { buildSectionSystemPrompt, buildSectionUserPrompt } from './refine-section.js';
export { buildSlideIterationPrompt, buildDeckIterationPrompt } from './iterate-deck.js';
