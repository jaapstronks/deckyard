/**
 * Shared AI-related constants.
 * Used by both server and client for consistent AI author identification.
 *
 * These defaults can be overridden via app settings:
 * - settings.aiAssistant.name
 * - settings.aiAssistant.email
 */

/** Default email identifier for AI-generated suggestions */
export const DEFAULT_AI_EMAIL = 'ai-assistant@deckyard.app';

/** Default display name for AI-generated suggestions */
export const DEFAULT_AI_NAME = 'AI Assistant';

// Legacy exports for backward compatibility
export const DREAMBOT_EMAIL = DEFAULT_AI_EMAIL;
export const DREAMBOT_NAME = DEFAULT_AI_NAME;