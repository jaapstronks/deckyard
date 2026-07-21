/**
 * Shared configuration and paths for the AI test suite.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SUITE_ROOT = path.resolve(HERE, '..');
export const REPO_ROOT = path.resolve(SUITE_ROOT, '..');
export const CASES_DIR = path.join(SUITE_ROOT, 'cases');
export const RUNS_DIR = path.join(SUITE_ROOT, 'runs');
export const CACHE_DIR = path.join(SUITE_ROOT, '.cache');
export const HISTORY_FILE = path.join(SUITE_ROOT, 'history.json');

/**
 * The model the judge runs on. The judge is the measuring instrument, so it
 * stays pinned to one model regardless of which vendor generated the deck --
 * otherwise scores from different runs are not on the same scale.
 */
export const MODEL = 'claude-opus-4-8';

/** Reasoning effort for the judge and topic extraction. */
export const JUDGE_EFFORT = 'high';

/**
 * Generation vendors the suite can drive, and the model it pins for each.
 *
 * Deckyard ships multi-vendor support, so "does generation hold up on another
 * vendor" is a real product question, not just a cost lever. gpt-5.5 is chosen
 * over the app's gpt-5.2 default because it sits at the same tier as
 * claude-opus-4-8 ($5/$30 vs $5/$25), which keeps the comparison honest, and
 * because OpenAI no longer publishes gpt-5.2 pricing -- an unpriced model would
 * make the cost report guesswork.
 */
export const GENERATION_VENDORS = {
  claude: { model: 'claude-opus-4-8', envVars: ['CLAUDE_MODEL', 'CLAUDE_MODEL_PLAN'] },
  openai: { model: 'gpt-5.5', envVars: ['OPENAI_MODEL'] },
};

export const DEFAULT_VENDOR = 'claude';

/**
 * USD per million tokens, per model.
 *
 * Every model the suite can drive must appear here: a run whose model is
 * missing would silently report a cost of zero, which is worse than no cost
 * report at all.
 */
export const PRICING = {
  'claude-opus-4-8': {
    input: 5.0,
    output: 25.0,
    cacheRead: 0.5, // ~0.1x input
    cacheWrite: 6.25, // ~1.25x input
  },
  'gpt-5.5': {
    input: 5.0,
    output: 30.0,
    cacheRead: 0.5,
    // OpenAI bills cached input at the read rate and does not charge a
    // separate write premium, so a write costs the same as plain input.
    cacheWrite: 5.0,
  },
};

/**
 * Prompt files that govern generation quality. The suite hashes these into a
 * prompt version so a report can be traced back to the prompts that produced
 * it. This list is the single source of truth for which files count.
 */
export const PROMPT_SOURCE_FILES = [
  'server/utils/ai/generate-outline.js',
  'server/utils/ai/refine-slides.js',
  'server/utils/ai/slide-catalog/builders.js',
  'server/utils/ai/slide-catalog/basic-content-slides.js',
  'server/utils/ai/slide-catalog/structural-slides.js',
  'server/utils/ai/slide-catalog/visual-content-slides.js',
  'server/utils/ai/slide-catalog/card-slides.js',
  'server/utils/ai/slide-catalog/diagram-slides.js',
  'server/utils/ai/slide-catalog/content-slides.js',
  'server/utils/ai/slide-catalog/people-slides.js',
  'server/utils/ai/slide-catalog/media-slides.js',
  'server/utils/ai/slide-catalog/interactive-slides.js',
  'server/utils/ai/slide-catalog/global-options.js',
  // The JSON examples are part of the prompt the model sees, and are exactly
  // where a prompt change is most likely to land -- round 1 edited only these
  // and the version hash did not move, which made the report claim nothing had
  // changed.
  'server/utils/ai/slide-catalog/examples/index.js',
  'server/utils/ai/slide-catalog/examples/basic-slides.js',
  'server/utils/ai/slide-catalog/examples/card-slides.js',
  'server/utils/ai/slide-catalog/examples/data-slides.js',
  'server/utils/ai/slide-catalog/examples/diagram-slides.js',
  'server/utils/ai/slide-catalog/examples/text-blocks-slide.js',
];

/** Rubric dimensions scored 1-5 by the judge for every case. */
export const RUBRIC_DIMENSIONS = [
  'coverage',
  'structure',
  'slideEconomy',
  'faithfulness',
  'presentability',
];

/** Extra dimension scored only for category A (a human reference deck exists). */
export const REFERENCE_DIMENSION = 'humanLikeness';

export const DIMENSION_LABELS = {
  coverage: 'Coverage',
  structure: 'Structure',
  slideEconomy: 'Slide economy',
  faithfulness: 'Faithfulness',
  presentability: 'Presentability',
  humanLikeness: 'Closeness to human deck',
};
