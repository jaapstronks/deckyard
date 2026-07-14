/**
 * Data source provider dispatcher.
 *
 * Routes data source operations to the correct provider based on the
 * provider type string. Follows the pattern from server/utils/llm/index.js.
 */

import { notionDatabaseProvider, notionBlockProvider } from './providers/notion.js';
import { csvUrlProvider } from './providers/csv-url.js';
import { validateDataSource } from '../../../shared/data-source.js';

const providers = {
  'notion-database': notionDatabaseProvider,
  'notion-block': notionBlockProvider,
  'csv-url': csvUrlProvider,
};

/**
 * Get the provider instance for a data source type.
 * @param {string} providerName
 * @returns {Object} Provider instance
 */
export function getProvider(providerName) {
  const provider = providers[providerName];
  if (!provider) {
    const err = new Error(`Unknown data source provider: ${providerName}`);
    err.statusCode = 400;
    throw err;
  }
  return provider;
}

/**
 * Refresh a slide's data from its data source.
 *
 * @param {Object} dataSource - The slide's dataSource config
 * @param {Object} currentContent - Current slide content (used as fallback)
 * @returns {Promise<{content: Object, applied: number, errors: string[], lastSync: string}>}
 */
export async function refreshSlideData(dataSource, currentContent) {
  const validation = validateDataSource(dataSource);
  if (!validation.valid) {
    const err = new Error(validation.error);
    err.statusCode = 400;
    throw err;
  }

  if (dataSource.refresh.mode === 'frozen') {
    return {
      content: currentContent,
      applied: 0,
      errors: [],
      lastSync: dataSource.lastSync || null,
    };
  }

  const provider = getProvider(dataSource.provider);
  return provider.refresh(dataSource.config, dataSource.bindings, currentContent);
}

/**
 * Fetch raw data from a provider (for previewing available fields).
 *
 * @param {string} providerName - Provider type
 * @param {Object} config - Provider-specific config
 * @returns {Promise<*>} Raw data from the source
 */
export async function fetchProviderData(providerName, config) {
  const provider = getProvider(providerName);
  return provider.fetch(config);
}

export { applyBindings } from './bindings.js';
