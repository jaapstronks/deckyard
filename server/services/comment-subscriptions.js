/**
 * Subscription resolver for comment events (phase 4 of the comments &
 * notifications plan) — the one place that decides: event → who.
 *
 * GitHub model. Candidates and their reasons (highest specificity first):
 *   mention        - the comment @mentions you (always delivered, even mute)
 *   reply          - you wrote the parent comment
 *   participating  - you own the deck or wrote in this thread
 *   watching       - you explicitly watch the deck
 *
 * Effective level per user: per-deck override (presentation_subscriptions)
 * → global default (user settings notifications.defaultLevel) →
 * 'participating'. The level filters the candidates; mentions always pass.
 *
 * In-app, email and webhook channels all consume this resolver's output;
 * `emailEnabled`/`slackEnabled` stay the per-channel master switches.
 */

import { repoRoot as defaultRepoRoot } from '../config/paths.js';
import { normalizeEmail } from '../utils/normalize.js';
import { parseMentions } from '../../shared/comment-mentions.js';
import { getThreadParticipants } from '../storage/presentation-comments.js';
import { listSubscriptions } from '../storage/presentation-subscriptions.js';
import { readUserSettings } from '../storage/settings.js';

/** Notification type per recipient reason. */
export const REASON_TO_TYPE = {
  mention: 'comment_mention',
  reply: 'comment_reply',
  participating: 'comment_created',
  watching: 'comment_created',
};

/**
 * Does a subscription level deliver an event with the given reason?
 * Pure; exported for tests. Mentions always deliver — muting a busy deck
 * stops everything except being addressed directly.
 * @param {string} level - watching | participating | mentions_only | mute
 * @param {string} reason - mention | reply | participating | watching
 * @returns {boolean}
 */
export function levelAllows(level, reason) {
  if (reason === 'mention') return true;
  switch (level) {
    case 'watching':
      return true;
    case 'mentions_only':
    case 'mute':
      return false;
    case 'participating':
    default: // Unknown levels behave as the default
      return reason === 'reply' || reason === 'participating';
  }
}

/**
 * Build the candidate map email → reason (most specific reason wins).
 * Pure; exported for tests.
 *
 * @param {Object} options
 * @param {Object} options.presentation
 * @param {Object} options.comment
 * @param {Object} [options.parentComment]
 * @param {Object} options.actor
 * @param {string[]} [options.threadParticipants] - Author emails in the thread
 * @param {string[]} [options.watchers] - Emails with an explicit watching override
 * @returns {Map<string, string>}
 */
export function buildCandidates({
  presentation,
  comment,
  parentComment,
  actor,
  threadParticipants = [],
  watchers = [],
}) {
  const candidates = new Map();
  const add = (email, reason) => {
    const e = normalizeEmail(email);
    if (e && !candidates.has(e)) candidates.set(e, reason);
  };

  // Insertion order = specificity: the first reason set for an email wins.
  const mentions = Array.isArray(comment?.mentions) && comment.mentions.length
    ? comment.mentions
    : parseMentions(comment?.body);
  for (const m of mentions) add(m?.email, 'mention');

  if (parentComment?.authorEmail) add(parentComment.authorEmail, 'reply');

  add(presentation?.ownerEmail, 'participating');
  add(presentation?.createdBy, 'participating');
  for (const email of threadParticipants) add(email, 'participating');

  for (const email of watchers) add(email, 'watching');

  candidates.delete(normalizeEmail(actor?.email)); // Never notify yourself
  return candidates;
}

/**
 * Resolve the recipients of a new comment, subscription-filtered.
 *
 * @param {Object} options
 * @param {string} [options.repoRoot] - For reading user settings
 * @param {Object} options.presentation
 * @param {Object} options.comment - The created comment
 * @param {Object} [options.parentComment]
 * @param {Object} options.actor
 * @param {Object} [options.ctx] - Storage context (org scoping)
 * @returns {Promise<Array<{email: string, reason: string}>>}
 */
export async function resolveCommentRecipients({
  repoRoot,
  presentation,
  comment,
  parentComment,
  actor,
  ctx,
}) {
  // Thread participants: everyone who wrote in the thread this comment
  // joins (only meaningful for replies).
  let threadParticipants = [];
  if (comment?.parentId) {
    try {
      threadParticipants = await getThreadParticipants(comment.parentId, ctx);
    } catch {
      threadParticipants = [];
    }
  }

  // Per-deck overrides (Map email → level); watchers join as candidates.
  let overrides = new Map();
  try {
    overrides = await listSubscriptions(presentation?.id, ctx);
  } catch {
    overrides = new Map();
  }
  const watchers = [...overrides.entries()]
    .filter(([, level]) => level === 'watching')
    .map(([email]) => email);

  const candidates = buildCandidates({
    presentation,
    comment,
    parentComment,
    actor,
    threadParticipants,
    watchers,
  });

  const recipients = [];
  for (const [email, reason] of candidates) {
    let level = overrides.get(email);
    if (!level) {
      try {
        const settings = await readUserSettings(repoRoot || defaultRepoRoot, email);
        level = settings?.notifications?.defaultLevel || 'participating';
      } catch {
        level = 'participating';
      }
    }
    if (levelAllows(level, reason)) {
      recipients.push({ email, reason });
    }
  }
  return recipients;
}
