/**
 * AI Streaming Helper
 *
 * Provides utilities for consuming Server-Sent Events from the AI V2 endpoints.
 */

import { processSSEStream } from './sse.js';

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
  api,
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
        throw new Error(data.error || 'Generation failed');
      },
    });

    if (!result) {
      throw new Error('Stream ended without completion');
    }

    return result.presentation;
  } catch (e) {
    onError({ error: e.message });
    throw e;
  }
}

/**
 * Simple status message rotator for non-streaming fallback
 * Rotates through messages at a fixed interval
 *
 * @param {Array<string>} messages - Status messages to rotate through
 * @param {Function} onMessage - Callback for each message
 * @param {number} interval - Milliseconds between messages (default 6500)
 * @returns {Function} Stop function to cancel the rotation
 */
export function rotateStatusMessages(messages, onMessage, interval = 6500) {
  if (!messages?.length) return () => {};

  let index = 0;
  let stopped = false;

  const tick = () => {
    if (stopped || index >= messages.length) return;
    onMessage(messages[index], index, messages.length);
    index++;
    if (index < messages.length) {
      setTimeout(tick, interval);
    }
  };

  tick();

  return () => {
    stopped = true;
  };
}

/**
 * Generate presentation using V2 (non-streaming) with simulated status messages
 *
 * @param {Object} options
 * @param {Function} options.api - API fetch function
 * @param {string} options.raw - Raw content
 * @param {string} options.lang - Language
 * @param {string} options.theme - Theme
 * @param {string} options.vendor - LLM vendor
 * @param {Object} options.settings - Settings
 * @param {Function} options.onStatus - Status callback
 * @returns {Promise<Object>} Created presentation
 */
export async function generatePresentationV2({
  api,
  raw,
  lang,
  theme,
  vendor = null,
  settings = null,
  onStatus = () => {},
} = {}) {
  // Start with a generic message
  onStatus({ message: lang === 'nl' ? 'Je presentatie wordt gemaakt...' : 'Creating your presentation...', progress: 5 });

  // First get the outline to get status messages
  let statusMessages = [];
  try {
    const outline = await api('/api/ai/wizard-v2/outline', {
      method: 'POST',
      body: JSON.stringify({ raw, lang, ...(vendor ? { vendor } : {}) }),
    });
    statusMessages = outline?.statusMessages || [];
  } catch {
    // Continue without status messages
  }

  // Start rotating status messages
  let messageIndex = 0;
  const messageInterval = setInterval(() => {
    if (messageIndex < statusMessages.length) {
      onStatus({
        message: statusMessages[messageIndex],
        progress: Math.min(10 + Math.round((messageIndex / statusMessages.length) * 70), 80),
      });
      messageIndex++;
    }
  }, 6500); // Show each message for ~6.5 seconds

  try {
    // Generate the full presentation
    const result = await api('/api/ai/wizard-v2', {
      method: 'POST',
      body: JSON.stringify({
        raw,
        lang,
        theme,
        ...(vendor ? { vendor } : {}),
        ...(settings ? { settings } : {}),
      }),
    });

    clearInterval(messageInterval);
    onStatus({ message: lang === 'nl' ? 'Bijna klaar...' : 'Almost done...', progress: 95 });

    return result;
  } catch (e) {
    clearInterval(messageInterval);
    throw e;
  }
}