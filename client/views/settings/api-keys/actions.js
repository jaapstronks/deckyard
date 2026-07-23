/**
 * API Key actions - fetch helpers for API key management.
 */

import { api } from '../../../lib/api.js';
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
    const data = await api(url);
    return { keys: data.keys || [] };
  } catch (e) {
    return { error: e.message || t('settings.apiKeys.fetchError', 'Failed to fetch API keys') };
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
    const data = await api('/api/api-keys', {
      method: 'POST',
      body: { name, scopes },
    });
    return { key: data };
  } catch (e) {
    return { error: e.message || t('settings.apiKeys.createError', 'Failed to create API key') };
  }
}

/**
 * Revoke an API key.
 * @param {string} id - Key ID
 * @returns {Promise<{success: boolean}|{error: string}>}
 */
export async function revokeApiKey(id) {
  try {
    await api(`/api/api-keys/${id}`, { method: 'DELETE' });
    return { success: true };
  } catch (e) {
    return { error: e.message || t('settings.apiKeys.revokeError', 'Failed to revoke API key') };
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
    const data = await api(`/api/api-keys/${id}/usage?days=${days}`);
    return { usage: data };
  } catch (e) {
    return { error: e.message || t('settings.apiKeys.usageError', 'Failed to fetch usage stats') };
  }
}
