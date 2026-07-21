/**
 * Status Message Rotator
 *
 * A utility for rotating through status messages during long-running operations.
 * Used by AI generation, file conversion, and Notion import features.
 */

/** Default interval between message rotations (ms) */
export const MESSAGE_INTERVAL = 6500;

/**
 * Create a message rotator that cycles through status messages.
 *
 * @param {Object} options
 * @param {Function} options.onUpdate - Called with (message, progress) when rotating
 * @param {number} [options.interval] - Interval between rotations (default: MESSAGE_INTERVAL)
 * @param {number} [options.baseProgress] - Starting progress percentage (default: 10)
 * @param {number} [options.maxProgress] - Maximum progress percentage (default: 85)
 * @returns {Object} Rotator controller with start, stop, and setMessages methods
 */
export function createMessageRotator({
  onUpdate,
  interval = MESSAGE_INTERVAL,
  baseProgress = 10,
  maxProgress = 85,
} = {}) {
  let messages = [];
  let currentIndex = 0;
  let timer = null;

  const rotate = () => {
    if (currentIndex < messages.length) {
      const message = messages[currentIndex];
      const progress = Math.min(
        baseProgress + Math.round((currentIndex / messages.length) * (maxProgress - baseProgress)),
        maxProgress
      );
      onUpdate?.(message, progress);
      currentIndex++;
      timer = setTimeout(rotate, interval);
    }
  };

  const stop = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const start = () => {
    if (messages.length > 0) {
      rotate();
    }
  };

  const setMessages = (newMessages) => {
    messages = newMessages || [];
    currentIndex = 0;
  };

  return {
    /**
     * Set the messages to rotate through and start rotation
     * @param {string[]} newMessages - Array of status messages
     */
    setMessages,

    /**
     * Start rotating through messages
     */
    start,

    /**
     * Stop the rotation timer
     */
    stop,

    /**
     * Get current state
     */
    getState: () => ({
      messages,
      currentIndex,
      isRunning: timer !== null,
    }),
  };
}