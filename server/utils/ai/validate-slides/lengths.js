/** Length refusal uses the same recursive field schema as strict validation. */
import { describeIssue, validateSlideContent } from '../schemas/index.js';

/** A length failure must be rewritten by the model, never sliced or fallen back. */
export class SlideTextLengthError extends Error {
  constructor(details) {
    super(
      details
        .map((d) => `Slide ${d.slideIndex} (${d.slideType}): ${d.message}`)
        .join('; '),
    );
    this.name = 'SlideTextLengthError';
    this.details = details;
  }
}

/** Refuse overlong strings, including nested item fields, without mutation. */
export function assertSlideTextLengths(slide, def) {
  const { issues } = validateSlideContent(def, slide.content);
  const details = issues
    .filter((issue) => issue.code === 'too_big' && issue.origin === 'string')
    .map((issue) => ({
      slideIndex: slide.originalIndex,
      slideType: slide.type,
      ...describeIssue(issue, slide.content),
    }));
  if (details.length) throw new SlideTextLengthError(details);
}
