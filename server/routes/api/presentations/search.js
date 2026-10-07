/**
 * Full-text search endpoint for presentations: the session user's collection,
 * matched on metadata and (with `deep=true`) slide content. Who is searched and
 * how a deck matches are decided in `listPresentationsForActor` (B607); this
 * route parses and answers.
 */

import { listPresentationsForActor } from '../../../services/presentations.js';
import { serveJson } from '../../../utils/http.js';
import { parseQueryFlag } from '../../../utils/request-validators.js';

/**
 * Search presentations with full-text matching
 */
export async function handlePresentationsSearch({
  storageScope,
  res,
  url,
  authedUser,
} = {}) {
  const query = url.searchParams.get('q')?.trim() ?? '';
  const deep = parseQueryFlag(url.searchParams, 'deep');

  const { presentations: results } = await listPresentationsForActor(
    storageScope,
    { actor: authedUser },
    { q: query, deep },
  );

  serveJson(res, 200, {
    query,
    deep: deep === true,
    count: results.length,
    results,
  });
  return true;
}
