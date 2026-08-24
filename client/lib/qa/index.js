/**
 * The audience-question surface: model, live feed, and writes.
 *
 * The follow page, the presenter's notes panel and the moderator route render
 * the same live question list. They used to each own a copy of the model, the
 * SSE subscription and the mutation paths, and the copies had drifted — most
 * visibly on which field carries the question text (B153). This is the one
 * owner; the views render.
 */

export {
  normalizeQuestion,
  normalizeQuestions,
  questionText,
  rankQuestions,
} from './question-model.js';
export { createQuestionsFeed, QA_POLL_MS } from './questions-feed.js';
export {
  askQuestion,
  cancelQuestion,
  fetchQuestions,
  promoteQuestion,
  removeQuestion,
  upvoteQuestion,
} from './mutations.js';
