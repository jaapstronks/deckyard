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
 * The model every part of the suite runs on: deck generation (via the app's
 * own pipeline) and the judge alike. Pinned so results stay comparable across
 * runs; `claude-opus-4-8` accepts no temperature, so effort plus the prompt
 * version hash is what makes a run reproducible.
 */
export const MODEL = 'claude-opus-4-8';

/** Reasoning effort for the judge and topic extraction. */
export const JUDGE_EFFORT = 'high';

/** USD per million tokens for MODEL. */
export const PRICING = {
  input: 5.0,
  output: 25.0,
  cacheRead: 0.5, // ~0.1x input
  cacheWrite: 6.25, // ~1.25x input
};

/**
 * Prompt files that govern generation quality. The suite hashes these into a
 * prompt version so a report can be traced back to the prompts that produced
 * it. Keep in sync with the prompt map in PLAN.md.
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
