import { createPresentation } from '../../../storage/presentations.js';
import { json, serveJson } from '../../../utils/http.js';
import { recordPresentationCreated } from '../../../services/activity-events.js';
import { createRouteContext } from '../../../utils/context.js';

export async function handlePresentationsCreate({ repoRoot, req, res, authedUser } = {}) {
  const body = await json(req);
  const created = await createPresentation(repoRoot, {
    ...body,
    ownerEmail: authedUser?.email || null,
  });

  // Record activity event (non-blocking)
  if (authedUser?.email) {
    void recordPresentationCreated({
      presentation: created,
      actor: authedUser,
      ctx: createRouteContext(authedUser),
    });
  }

  serveJson(res, 201, created);
  return true;
}
