/**
 * Shared AI-related constants.
 * Used by both server and client for consistent AI author identification.
 *
 * These defaults can be overridden via app settings:
 * - settings.aiAssistant.name
 * - settings.aiAssistant.email
 */

/** Default email identifier for AI-generated suggestions */
export const DEFAULT_AI_EMAIL = 'ai-assistant@deckyard.eu';

/** Default display name for AI-generated suggestions */
export const DEFAULT_AI_NAME = 'AI Assistant';

/**
 * Addresses that older AI-authored comments were written under before the
 * identity moved (and before it became configurable). Recognition still
 * accepts these so existing rows keep their AI styling without a backfill
 * migration — the same choice the deck format made with `slidecreator.deck`:
 * write the new value, accept the old on read.
 */
export const LEGACY_AI_EMAILS = ['ai-assistant@deckyard.app'];

// Legacy exports for backward compatibility
export const DREAMBOT_EMAIL = DEFAULT_AI_EMAIL;
export const DREAMBOT_NAME = DEFAULT_AI_NAME;

/**
 * Does `email` identify the AI author of a comment?
 *
 * The identity is configurable (settings.aiAssistant.email), so recognition
 * cannot compare against a single hardcoded constant. It accepts, in order:
 * the effective configured address, the built-in default, and any legacy
 * address. Kept in `shared/` so client (comment styling) and server agree.
 *
 * Comparison is case-insensitive: comment rows store the author address
 * lowercased (see storage/presentations/comments.js), while the configured
 * setting is kept verbatim, so a mixed-case identity would otherwise never
 * match its own comments.
 *
 * @param {string} [email] - candidate comment author email
 * @param {string} [configuredEmail] - the effective settings.aiAssistant.email
 *   (already resolved to the default when unset); optional
 * @returns {boolean}
 */
export function isAiAuthorEmail(email, configuredEmail) {
  if (!email) return false;
  const candidate = String(email).trim().toLowerCase();
  if (!candidate) return false;
  if (
    configuredEmail &&
    candidate === String(configuredEmail).trim().toLowerCase()
  )
    return true;
  if (candidate === DEFAULT_AI_EMAIL) return true;
  return LEGACY_AI_EMAILS.includes(candidate);
}
