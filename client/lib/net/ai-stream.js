/**
 * AI Streaming Helper
 *
 * Provides utilities for consuming Server-Sent Events from the AI V2 endpoints.
 */

import { processSSEStream } from './sse.js';
import { t } from '../ui-i18n.js';

/**
 * Generate a presentation using the streaming V2 endpoint
 *
 * @param {Object} options
 * @param {Function} options.api - API fetch function
 * @param {string} options.raw - Raw content to convert
 * @param {string} options.lang - Language mode ('nl' or 'en-GB')
 * @param {string} options.theme - Theme ID
 * @param {string} options.vendor - LLM vendor (optional)
 * @param {string} options.targetLength - Target length: 'auto', '5min', '10min', '20min', '30min' (optional)
 * @param {Object} options.settings - Presentation settings (optional)
 * @param {string} options.notionSourcePageId - Notion page ID if content came from Notion (optional)
 * @param {Function} options.onStatus - Callback for status updates ({ message, progress, phase })
 * @param {Function} options.onMessages - Callback when all status messages are available
 * @param {Function} options.onComplete - Callback when complete ({ presentation, sessionId })
 * @param {Function} options.onError - Callback on error ({ error })
 * @returns {Promise<Object>} The created presentation
 */
export async function generatePresentationStreaming({
  raw,
  lang,
  theme,
  vendor = null,
  targetLength = 'auto',
  settings = null,
  notionSourcePageId = null,
  onStatus = () => {},
  onMessages = () => {},
  onComplete = () => {},
  onError = () => {},
} = {}) {
  // Build the API URL - we need the base URL
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const url = `${baseUrl}/api/ai/wizard-v2/stream`;

  const body = {
    raw,
    lang,
    theme,
    ...(vendor ? { vendor } : {}),
    ...(targetLength && targetLength !== 'auto' ? { targetLength } : {}),
    ...(settings ? { settings } : {}),
    ...(notionSourcePageId ? { notionSourcePageId } : {}),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `HTTP ${response.status}`);
    }

    let result = null;

    await processSSEStream(response.body, {
      onStatus: (data) => onStatus(data),
      onMessages: (data) => onMessages(data),
      onComplete: (data) => {
        result = data;
        onComplete(data);
      },
      onError: (data) => {
        onError(data);
        throw new Error(data.message || t('ai.generationFailed', 'Generation failed'));
      },
    });

    if (!result) {
      throw new Error(t('ai.streamIncomplete', 'Stream ended without completion'));
    }

    return result.presentation;
  } catch (e) {
    onError({ error: e.message });
    throw e;
  }
}
