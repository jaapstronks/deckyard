/**
 * Build the post-auth-gate context that routes/api/index.js hands to handlers
 * mounted after the login gate: the resolved, capability-enriched user plus the
 * storage scope, built once. Tests that exercise a post-gate handler in
 * isolation use this so they see the same AuthedContext production does, rather
 * than re-implementing the gate (and drifting from it).
 *
 * Mirrors server/routes/api/index.js lines ~142-169 for the non-sandbox path:
 * resolve the user, enrich with designer capability, then create the storage
 * scope. The designer enrichment fails open, exactly as index.js does.
 *
 * Import this dynamically (after any module-scope env setup) in tests that set
 * env vars before importing, since it pulls in server/config/features.js.
 */

import { getUserFromRequestAsync } from '../../server/auth/auth.js';
import { resolveDesignerCapability } from '../../server/utils/designer.js';
import { canEditCustomHtml } from '../../server/utils/route-middleware.js';
import { createStorageScope } from '../../server/utils/context.js';

/**
 * @param {{repoRoot: string|null, req: object, res: object, url: URL}} parts
 * @returns {Promise<object>} The AuthedContext: { repoRoot, storageScope, req, res, url, authedUser }.
 */
export async function authedRouteContext({ repoRoot, req, res, url }) {
  let authedUser = await getUserFromRequestAsync(req, { repoRoot, req });

  if (authedUser?.email) {
    try {
      const isDesigner = await resolveDesignerCapability(authedUser);
      authedUser = { ...authedUser, isDesigner };
      authedUser = {
        ...authedUser,
        canEditCustomHtml: canEditCustomHtml(authedUser),
      };
    } catch {
      // Fail open — do not block on designer resolution, as index.js does.
    }
  }

  const storageScope = createStorageScope(authedUser, { repoRoot });

  return { repoRoot, storageScope, req, res, url, authedUser };
}
