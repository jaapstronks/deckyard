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
export {
  buildPhase2SystemPrompt,
  buildThemeContextSection,
  buildPhase2UserPrompt,
} from './refine-slides.js';
export { buildRevisionSystemPrompt, buildRevisionUserPrompt } from './revise-outline.js';
export { buildSectionSystemPrompt, buildSectionUserPrompt } from './refine-section.js';
export { buildSlideIterationPrompt, buildDeckIterationPrompt } from './iterate-deck.js';
