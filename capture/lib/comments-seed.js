/**
 * Seed comment threads for the `comments-{nl,en}` marketing shot.
 *
 * **Why this one helper talks to storage instead of REST.** Every other seeder
 * in `capture/` goes through the API, on purpose: a state the REST surface can
 * produce is a state the app can really be in. A comment thread is the one
 * exception, and the reason is identity, not convenience. `POST
 * /api/presentations/:id/comments` takes its author from the *request* —
 * `authorName` is `authedUser.name`, never a body field, and rightly so; a
 * comments API that let the caller name someone else would be an
 * impersonation hole. The capture run is authenticated by `AUTH_DEV_BYPASS`,
 * which pins one hard-coded identity (`Dev <dev@local>`) for every request in
 * the process. So over REST every comment in the shot is by the same "Dev",
 * and a shot of one person talking to themselves under a debug name is not the
 * picture the collaboration section is making.
 *
 * The seam therefore sits one layer down: `createComment()` *does* take an
 * author, because the route is what binds it to the session. Writing through
 * it is the same pattern `scripts/create-api-key.js` uses (load .env,
 * initialize storage, call the storage function) — this is a seeding script,
 * not a second way for the app to write comments.
 *
 * The connection is a second pool against the same Postgres the dev server
 * uses; {@link closeCommentSeedStorage} must run before the process exits or
 * the open pool keeps the runner alive.
 */

import { loadDotEnv } from '../../server/config/env.js';
import { repoRoot } from '../../server/config/paths.js';
import { initializeStorage, closeStorage } from '../../server/storage/adapters/index.js';
import {
  createComment,
  resolveComment,
} from '../../server/storage/presentations/comments.js';

let initialized = false;

/**
 * Context every seeded write runs in: the default organization, which is the
 * one `AUTH_DEV_BYPASS` pins requests to (`getUserFromRequest` →
 * `getDefaultOrganizationId()`), so a seeded comment lands in the same
 * organization the browser is looking at.
 * @returns {Promise<{repoRoot: string, actorEmail: string}>}
 */
async function ensureStorage() {
  if (!initialized) {
    await loadDotEnv(repoRoot);
    await initializeStorage(repoRoot);
    initialized = true;
  }
  // organizationId is deliberately left off: getOrgId() then falls back to
  // getDefaultOrganizationId(), the same default the dev bypass resolves to.
  return { repoRoot, actorEmail: 'capture@local' };
}

/**
 * @typedef {object} SeedAuthor
 * @property {string} name Display name shown in the panel.
 * @property {string} email Address stored on the comment. Never rendered while
 *   `name` is set (the renderer falls back to the address only for a nameless
 *   comment), but it is what "is this mine?" is decided on — so keep it off
 *   the capture user's own address if the shot should not offer Delete.
 */

/**
 * @typedef {object} SeedThread
 * @property {SeedAuthor} author
 * @property {string} body
 * @property {string} slideId
 * @property {boolean} [resolved] Resolve the thread after seeding it.
 * @property {Array<{author: SeedAuthor, body: string}>} [replies]
 */

/**
 * Create comment threads with explicit authors, oldest first.
 *
 * Threads are seeded in array order and the panel lists newest first, so the
 * last entry here is the top card in the shot.
 *
 * @param {string} presentationId
 * @param {SeedThread[]} threads
 * @returns {Promise<string[]>} ids of the created top-level comments
 */
export async function seedCommentThreads(presentationId, threads) {
  const ctx = await ensureStorage();
  const ids = [];

  for (const thread of threads) {
    const created = await createComment(
      presentationId,
      {
        email: thread.author.email,
        name: thread.author.name,
        body: thread.body,
        slideId: thread.slideId,
      },
      ctx
    );
    if (!created?.ok) {
      throw new Error(
        `Seeding comment failed: ${created?.reason || 'unknown'} (${thread.body.slice(0, 40)}…)`
      );
    }
    ids.push(created.comment.id);

    for (const reply of thread.replies || []) {
      const repliedTo = await createComment(
        presentationId,
        {
          email: reply.author.email,
          name: reply.author.name,
          body: reply.body,
          slideId: thread.slideId,
          parentId: created.comment.id,
        },
        ctx
      );
      if (!repliedTo?.ok) {
        throw new Error(
          `Seeding reply failed: ${repliedTo?.reason || 'unknown'} (${reply.body.slice(0, 40)}…)`
        );
      }
    }

    if (thread.resolved) {
      // Resolve last: resolveComment only matches an open comment, and the
      // replies have to exist before the thread is closed over them.
      const done = await resolveComment(
        created.comment.id,
        { email: thread.author.email },
        ctx
      );
      if (!done?.ok) {
        throw new Error(`Resolving seeded comment failed: ${done?.reason || 'unknown'}`);
      }
    }
  }

  return ids;
}

/**
 * Close the seeding pool. Without this the runner process never exits, because
 * an idle pg pool keeps the event loop alive.
 * @returns {Promise<void>}
 */
export async function closeCommentSeedStorage() {
  if (!initialized) return;
  await closeStorage();
  initialized = false;
}
