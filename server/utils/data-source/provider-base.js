/**
 * Base factory for creating data source providers.
 *
 * Follows the same pattern as server/utils/llm/provider-base.js:
 * each provider is created via a factory that returns a standardized
 * fetch-and-parse function.
 */

import { applyBindings } from './bindings.js';
import { AppError, isAppError } from '../errors.js';
import { logError } from '../logger.js';

/**
 * Create a data source provider.
 *
 * @param {Object} config
 * @param {string} config.name - Provider name for error messages
 * @param {Function} config.fetchData - (providerConfig) => Promise<raw data>
 * @param {Function} config.parseResponse - (rawData, bindings) => { [sourceKey]: value }
 * @returns {Object} Provider with { name, fetch, refresh } methods
 */
export function createDataSourceProvider({ name, fetchData, parseResponse }) {
  return {
    name,

    /**
     * Fetch raw data from the external source.
     * @param {Object} providerConfig - Provider-specific config (url, databaseId, etc.)
     * @returns {Promise<*>} Raw data from the source
     */
    async fetch(providerConfig) {
      try {
        return await fetchData(providerConfig);
      } catch (err) {
        // An AppError already says what it means in our own words (the
        // provider's input refusal, the Notion seam's sentence): it goes out
        // as it is. Anything else is internal text - a network error, an
        // upstream body, a path - so it goes to the log, and the caller gets
        // one fixed 502 per provider (B417).
        if (isAppError(err)) throw err;
        logError('data-source', `Data source "${name}" fetch failed:`, err);
        throw new AppError(`Data source "${name}" could not be fetched`, 502);
      }
    },

    /**
     * Fetch data and apply bindings to slide content.
     * @param {Object} providerConfig - Provider-specific config
     * @param {Array} bindings - Binding definitions
     * @param {Object} currentContent - Current slide content (fallback)
     * @returns {Promise<{content: Object, applied: number, errors: string[], lastSync: string}>}
     */
    async refresh(providerConfig, bindings, currentContent) {
      const rawData = await this.fetch(providerConfig);
      const mapped = parseResponse(rawData, bindings);
      const { content, applied, errors } = applyBindings(
        currentContent,
        bindings,
        mapped,
      );

      return {
        content,
        applied,
        errors,
        lastSync: new Date().toISOString(),
      };
    },
  };
}
