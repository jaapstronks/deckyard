/**
 * Route handler for AI-powered presentation analysis.
 * Analyzes presentations and creates improvement suggestions as comments.
 */

import { getPresentation } from '../../../storage/presentations.js';
import {
  json,
  methodNotAllowed,
  notFound,
  unauthorized,
} from '../../../utils/http.js';
import { canWritePresentation } from '../../../utils/presentation-authz.js';
import { createComment } from '../../../storage/presentation-comments.js';
import { createRouteContext } from '../../../utils/context.js';
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
const log = createLogger('analyze');

const getCtx = createRouteContext;

/**
 * Send SSE event to client
 */
function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

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
 */
export async function handlePresentationAnalyze(
  { repoRoot, req, res, authedUser } = {},
  id
) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const pres = await getPresentation(repoRoot, id);
  if (!pres) return notFound(res);

  // Only users with edit permission can trigger analysis
  if (!canWritePresentation({ user: authedUser, pres })) {
    return unauthorized(res);
  }

  // Parse request body for optional category filter (body is size-capped by
  // json()/readRequestBody; oversized or invalid bodies fall back to defaults).
  let categories = null;
  try {
    const body = await json(req);
    if (Array.isArray(body?.categories)) {
      categories = body.categories;
    }
  } catch {
    // Ignore parse/size errors, use defaults
  }

  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial connection confirmation
  sendSSE(res, 'connected', { presentationId: id });

  const ctx = getCtx(authedUser);

  // Get AI identity from settings (custom name/email if configured)
  const aiIdentity = await getAiIdentity(repoRoot);

  try {
    // Run analysis
    sendSSE(res, 'progress', { phase: 'analyzing', slideCount: pres.slides?.length || 0 });

    const result = await analyzePresentation(pres, {
      categories,
      onProgress: (progress) => {
        sendSSE(res, 'progress', progress);
      },
    });

    const { suggestions } = result;

    if (suggestions.length === 0) {
      sendSSE(res, 'complete', { suggestionCount: 0, message: 'No suggestions found' });
      res.end();
      return true;
    }

    // Create comments for each suggestion
    sendSSE(res, 'progress', { phase: 'creating', total: suggestions.length });

    const createdComments = [];
    for (let i = 0; i < suggestions.length; i++) {
      const suggestion = suggestions[i];
      const commentData = suggestionToCommentData(suggestion, id, aiIdentity);

      const createResult = await createComment(id, commentData, ctx);

      if (createResult.ok) {
        createdComments.push(createResult.comment);
        sendSSE(res, 'suggestion', {
          index: i + 1,
          total: suggestions.length,
          comment: createResult.comment,
        });

        // Broadcast to other connected clients
        void broadcastToPresentation(id, CommentEventTypes.CREATED, {
          comment: createResult.comment,
        });
      }
    }

    sendSSE(res, 'complete', {
      suggestionCount: createdComments.length,
      metadata: result.metadata,
    });
  } catch (error) {
    log.error('[analyze] Error:', error);
    sendSSE(res, 'error', {
      message: error?.message || 'Analysis failed',
    });
  }

  res.end();
  return true;
}