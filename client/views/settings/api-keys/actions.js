/**
 * API Key actions - fetch helpers for API key management.
 */

import { t } from '../../../lib/ui-i18n.js';

/**
 * Fetch all API keys for the current user.
 * @param {Object} options
 * @param {boolean} [options.includeRevoked=false] - Include revoked keys
 * @returns {Promise<{keys: Array}|{error: string}>}
 */
export async function fetchApiKeys({ includeRevoked = false } = {}) {
  try {
    const url = includeRevoked ? '/api/api-keys?includeRevoked=true' : '/api/api-keys';
    const res = await fetch(url);
    const data = await res.json();

    if (res.ok) {
      return { keys: data.keys || [] };
    }
    return { error: data.error || t('settings.apiKeys.fetchError', 'Failed to fetch API keys') };
  } catch (e) {
    return { error: t('settings.apiKeys.fetchError', 'Failed to fetch API keys') };
  }
}

/**
 * Create a new API key.
 * @param {Object} options
 * @param {string} options.name - Key name
 * @param {string[]} options.scopes - Key scopes
 * @returns {Promise<{key: Object}|{error: string}>}
 */
export async function createApiKey({ name, scopes }) {
  try {
    const res = await fetch('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, scopes }),
    });

    const data = await res.json();

    if (res.ok) {
      return { key: data };
    }
    return { error: data.error || t('settings.apiKeys.createError', 'Failed to create API key') };
  } catch (e) {
    return { error: t('settings.apiKeys.createError', 'Failed to create API key') };
  }
}

/**
 * Revoke an API key.
 * @param {string} id - Key ID
 * @returns {Promise<{success: boolean}|{error: string}>}
 */
export async function revokeApiKey(id) {
  try {
    const res = await fetch(`/api/api-keys/${id}`, {
      method: 'DELETE',
    });

    if (res.ok) {
      return { success: true };
    }
    const data = await res.json();
    return { error: data.error || t('settings.apiKeys.revokeError', 'Failed to revoke API key') };
  } catch (e) {
    return { error: t('settings.apiKeys.revokeError', 'Failed to revoke API key') };
  }
}

/**
 * Fetch usage stats for an API key.
 * @param {string} id - Key ID
 * @param {number} [days=30] - Number of days of history
 * @returns {Promise<{usage: Object}|{error: string}>}
 */
export async function fetchKeyUsage(id, days = 30) {
  try {
    const res = await fetch(`/api/api-keys/${id}/usage?days=${days}`);
    const data = await res.json();

    if (res.ok) {
      return { usage: data };
    }
    return { error: data.error || t('settings.apiKeys.usageError', 'Failed to fetch usage stats') };
  } catch (e) {
    return { error: t('settings.apiKeys.usageError', 'Failed to fetch usage stats') };
  }
}
