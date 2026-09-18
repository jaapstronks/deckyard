/**
 * Route handler for AI-powered presentation analysis.
 * Analyzes presentations and creates improvement suggestions as comments.
 */

import { getPresentation } from '../../../storage/presentations/index.js';
import {
  methodNotAllowed,
  notFound,
  requireJsonBody,
  forbidden,
} from '../../../utils/http.js';
import { canWritePresentation } from '../../../utils/presentation-authz/index.js';
import { createComment } from '../../../storage/presentations/comments.js';
import {
  analyzePresentation,
  suggestionToCommentData,
} from '../../../utils/ai/analyze-presentation.js';
import {
  broadcastToPresentation,
  CommentEventTypes,
} from '../../../services/comment-events.js';
import { getAiIdentity } from '../../../storage/settings.js';
import { createLogger } from '../../../utils/logger.js';
import { sseWrite, sseError, openSseStream } from '../../../utils/sse.js';
const log = createLogger('analyze');

/**
 * Analyze a presentation and create AI suggestions as comments.
 * POST /api/presentations/:id/analyze
 *
 * Uses SSE to stream progress updates and suggestions to the client.
 *
 * Request body (optional):
 * { categories: ['language', 'slide-type', ...] }
 *
 * SSE Events:
 * - progress: { phase: 'analyzing'|'parsing'|'creating'|'complete', ... }
 * - suggestion: { index, total, suggestion }
 * - complete: { suggestionCount }
 * - error: { message }
 *
 * Cancelling is closing the stream. The stream's disconnect signal aborts
 * the model call, and is checked before every comment is created: after the
 * client leaves, no new suggestion is stored or broadcast. A comment whose
 * write was already under way when the client left is kept and broadcast
 * like any other, so live viewers see what storage holds.
 */
export async function handlePresentationAnalyze(
  { storageScope, req, res, authedUser } = {},
  id,
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(storageScope, id);
  if (!pres) return notFound(res);

  // Only users with edit permission can trigger analysis
  if (!canWritePresentation({ user: authedUser, pres })) {
    return forbidden(res);
  }

  // Optional category filter. An absent body means "analyze everything"; a
  // malformed or oversized one is answered before the SSE stream opens, since
  // once the 200 + event-stream headers are out there is no way back to a 400.
  const parsed = await requireJsonBody(req, res, { allowEmpty: true });
  if (!parsed.ok) return true;
  const categories = Array.isArray(parsed.body?.categories)
    ? parsed.body.categories
    : null;

  const stream = openSseStream(req, res);
  if (!stream.ok) return true;
  const { signal } = stream;

  // Send initial connection confirmation
  sseWrite(res, { event: 'connected', data: { presentationId: id } });

  // Get AI identity from settings (custom name/email if configured)
  const aiIdentity = await getAiIdentity(storageScope);

  try {
    // Run analysis
    sseWrite(res, {
      event: 'progress',
      data: {
        phase: 'analyzing',
        slideCount: pres.slides?.length || 0,
      },
    });

    const result = await analyzePresentation(pres, {
      categories,
      signal,
      onProgress: (progress) => {
        sseWrite(res, { event: 'progress', data: progress });
      },
    });

    const { suggestions } = result;

    if (suggestions.length === 0) {
      sseWrite(res, {
        event: 'complete',
        data: {
          suggestionCount: 0,
          message: 'No suggestions found',
        },
      });
      res.end();
      return true;
    }

    // Create comments for each suggestion
    sseWrite(res, {
      event: 'progress',
      data: { phase: 'creating', total: suggestions.length },
    });

    const createdComments = [];
    for (let i = 0; i < suggestions.length; i++) {
      signal.throwIfAborted();
      const suggestion = suggestions[i];
      const commentData = suggestionToCommentData(suggestion, id, aiIdentity);

      const createResult = await createComment(storageScope, id, commentData);

      if (createResult.ok) {
        createdComments.push(createResult.comment);
        sseWrite(res, {
          event: 'suggestion',
          data: {
            index: i + 1,
            total: suggestions.length,
            comment: createResult.comment,
          },
        });

        // Broadcast to other connected clients
        broadcastToPresentation(id, CommentEventTypes.CREATED, {
          comment: createResult.comment,
        });
      }
    }

    sseWrite(res, {
      event: 'complete',
      data: {
        suggestionCount: createdComments.length,
        metadata: result.metadata,
      },
    });
  } catch (error) {
    if (signal.aborted) {
      log.info(`${id}: cancelled by the client`);
    } else {
      log.error('Error:', error);
      sseError(res, error?.message || 'Analysis failed');
    }
  }

  res.end();
  return true;
}
