/**
 * Deck-activity notifications: "someone worked on your deck".
 *
 * When a collaborator adds slides to a deck you own (or collaborate on), you
 * get one bundled notification in the bell instead of a ping per slide. The
 * bundling is coalesce-on-write: a new slide-add within a debounce window
 * (default 60 min, `DECK_ACTIVITY_NOTIFY_WINDOW_MIN`) merges into the existing
 * unread `deck_activity` row for that (recipient, deck, actor) — the count goes
 * up and the row jumps back to the top — rather than creating a second row.
 *
 * Rules (mirrors the comment-notification resolver):
 *   - The actor never notifies themselves.
 *   - Subscription levels are respected: mute / mentions_only get nothing;
 *     the owner's default ('participating') and explicit 'watching' deliver.
 *
 * Layer 1 (the `slide.added` activity-feed event) already exists; this is
 * layer 2. See docs/reference/deck-activity-notifications.md.
 */

import { repoRoot as defaultRepoRoot } from '../config/paths.js';
import { normalizeEmail } from '../utils/normalize.js';
import { listCollaborators } from '../storage/collaborators.js';
import { listSubscriptions } from '../storage/presentation-subscriptions.js';
import { readUserSettings } from '../storage/settings.js';
import { levelAllows } from './comment-subscriptions.js';
import {
  createNotification,
  findUnreadDeckActivityNotification,
  refreshDeckActivityNotification,
  getUnreadCount,
} from '../storage/notifications.js';
import { broadcastToUser, NotificationEventTypes } from './notification-events.js';

export const DECK_ACTIVITY_TYPE = 'deck_activity';

/** Debounce window in minutes (env-configurable, default 60). */
export function deckActivityWindowMinutes() {
  const raw = parseInt(process.env.DECK_ACTIVITY_NOTIFY_WINDOW_MIN || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 60;
}

/**
 * Title copy for a bundled deck-activity notification. English, matching the
 * other server-side notification copy. The only trigger today is slide-adds.
 * @param {string} actorName
 * @param {number} count - Total slides added within the window.
 * @param {string} presentationTitle
 * @returns {string}
 */
export function formatDeckActivityTitle(actorName, count, presentationTitle) {
  const who = actorName || 'Someone';
  const title = presentationTitle || 'Untitled';
  return count === 1
    ? `${who} added a slide to "${title}"`
    : `${who} added ${count} slides to "${title}"`;
}

/**
 * Build the candidate recipients for a deck-activity event (owner + createdBy +
 * collaborators), with the actor removed. Pure; level-filtering happens after.
 * @param {Object} options
 * @param {Object} options.presentation
 * @param {Object} options.actor
 * @param {string[]} [options.collaborators] - Emails with standing deck access.
 * @returns {string[]} Deduped, normalised recipient emails (actor excluded).
 */
export function buildDeckActivityCandidates({ presentation, actor, collaborators = [] }) {
  const set = new Set();
  const add = (email) => {
    const e = normalizeEmail(email);
    if (e) set.add(e);
  };
  add(presentation?.ownerEmail);
  add(presentation?.createdBy);
  for (const c of collaborators) add(c);
  set.delete(normalizeEmail(actor?.email)); // Never notify yourself.
  return [...set];
}

/**
 * Build the createNotification-ready payload for a deck-activity bundle. Pure;
 * exported for tests. The same payload shape is used for both a fresh row and
 * a coalesced refresh (only title + data change as the count grows).
 * @param {Object} options
 * @param {Object} options.presentation
 * @param {Object} options.actor
 * @param {number} options.count - Total slides added within the window.
 * @returns {Object}
 */
export function buildDeckActivityNotificationInput({ presentation, actor, count }) {
  const presentationTitle = presentation?.title || 'Untitled';
  const actorName = actor?.name || actor?.email || 'Someone';
  return {
    notificationType: DECK_ACTIVITY_TYPE,
    title: formatDeckActivityTitle(actorName, count, presentationTitle),
    body: null,
    presentationId: presentation?.id || null,
    actorEmail: normalizeEmail(actor?.email) || null,
    actorName: actor?.name || null,
    actionUrl: presentation?.id ? `/app/${presentation.id}` : null,
    data: { presentationTitle, slideCount: count, kind: 'slide_added' },
  };
}

/**
 * Resolve which deck members should receive the deck-activity notification,
 * respecting per-deck and default subscription levels. Mirrors
 * resolveCommentRecipients but for a "someone worked on your deck" signal:
 * every candidate is treated as 'participating', so the owner's default level
 * delivers while mute / mentions_only opt out.
 *
 * @param {Object} options
 * @param {string} [options.repoRoot]
 * @param {Object} options.presentation
 * @param {Object} options.actor
 * @param {Object} [options.ctx]
 * @returns {Promise<string[]>} Recipient emails.
 */
export async function resolveDeckActivityRecipients({ repoRoot, presentation, actor, ctx }) {
  let collaborators = [];
  try {
    collaborators = (await listCollaborators(presentation?.id, ctx))
      .map((c) => c?.userEmail)
      .filter(Boolean);
  } catch {
    collaborators = [];
  }

  const candidates = buildDeckActivityCandidates({ presentation, actor, collaborators });
  if (candidates.length === 0) return [];

  let overrides = new Map();
  try {
    overrides = await listSubscriptions(presentation?.id, ctx);
  } catch {
    overrides = new Map();
  }

  const resolved = await Promise.all(
    candidates.map(async (email) => {
      let level = overrides.get(email);
      if (!level) {
        try {
          const settings = await readUserSettings(repoRoot || defaultRepoRoot, email);
          level = settings?.notifications?.defaultLevel || 'participating';
        } catch {
          level = 'participating';
        }
      }
      // Deck activity is a 'participating'-grade signal: owners on the default
      // level get it, mute / mentions_only do not.
      return levelAllows(level, 'participating') ? email : null;
    })
  );
  return resolved.filter(Boolean);
}

/**
 * Notify a deck's members that a collaborator added slides, bundled per
 * (recipient, deck, actor) within the debounce window. Fire-and-forget: never
 * throws, logs failures. Pushes the bell live over SSE (NEW for the list,
 * COUNTS for an authoritative badge that stays correct across coalescing).
 *
 * @param {Object} options
 * @param {string} [options.repoRoot]
 * @param {Object} options.presentation - The saved deck (ownerEmail/createdBy).
 * @param {Object} options.actor - The editing user.
 * @param {number} options.slideCount - Slides added in this save.
 * @param {Object} [options.ctx] - Storage context (org scoping).
 */
export async function notifyDeckActivity({ repoRoot, presentation, actor, slideCount, ctx }) {
  try {
    if (!presentation?.id || !actor?.email) return;
    const added = Number.isInteger(slideCount) && slideCount > 0 ? slideCount : 1;

    const recipients = await resolveDeckActivityRecipients({ repoRoot, presentation, actor, ctx });
    if (recipients.length === 0) return;

    const actorEmail = normalizeEmail(actor?.email) || null;
    const windowMin = deckActivityWindowMinutes();
    const since = new Date(Date.now() - windowMin * 60 * 1000).toISOString();

    for (const recipientEmail of recipients) {
      try {
        const existing = await findUnreadDeckActivityNotification(
          recipientEmail,
          presentation.id,
          actorEmail,
          since,
          ctx
        );
        const prevCount = Number(existing?.data?.slideCount) || 0;
        const count = prevCount + added;
        const input = buildDeckActivityNotificationInput({ presentation, actor, count });

        let notification = null;
        if (existing) {
          const res = await refreshDeckActivityNotification(
            existing.id,
            recipientEmail,
            { title: input.title, body: input.body, data: input.data },
            ctx
          );
          notification = res?.ok ? res.notification : null;
        } else {
          const res = await createNotification({ ...input, userEmail: recipientEmail }, ctx);
          notification = res?.ok ? res.notification : null;
        }

        if (notification) {
          broadcastToUser(recipientEmail, NotificationEventTypes.NEW, notification);
          const unreadCount = await getUnreadCount(recipientEmail, ctx);
          broadcastToUser(recipientEmail, NotificationEventTypes.COUNTS, { unreadCount });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `[deck-activity] notification failed to=${recipientEmail}:`,
          e?.message || e
        );
      }
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[deck-activity] notifyDeckActivity error:', e?.message || e);
  }
}
