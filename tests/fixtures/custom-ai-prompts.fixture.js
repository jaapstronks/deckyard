/**
 * Fixture standing in for a fork's `custom/ai/prompts.js`.
 * Exercises the loader's accept/ignore rules:
 *  - a valid override for a known builder      -> kept
 *  - a non-function value                       -> ignored
 *  - a function whose name is not a builder      -> ignored (unknown key)
 */
export default {
  buildPhase1SystemPrompt() {
    return 'CUSTOM_OUTLINE_PROMPT';
  },
  buildDeckIterationPrompt: 'not-a-function',
  notARealBuilder() {
    return 'nope';
  },
};
