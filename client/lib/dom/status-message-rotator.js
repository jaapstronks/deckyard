/**
 * Status Message Rotator
 *
 * Cycles through status messages during a long-running operation, so the
 * message line keeps saying what the server is working on while a single
 * phase runs. Used by AI generation, file conversion and Notion import.
 *
 * The rotator owns the **message line only**. The progress bar belongs to the
 * loading modal, which is driven by real stream events and its creep
 * (`docs/reference/import-progress.md`): a rotation index is not progress, and
 * a rotator that restarts would otherwise walk the bar backwards.
 */

/** Default interval between message rotations (ms) */
const MESSAGE_INTERVAL = 6500;

/**
 * Create a message rotator that cycles through status messages.
 *
 * @param {Object} options
 * @param {(message: string) => void} options.onUpdate - Called with the next
 *   message each time the rotator advances.
 * @param {number} [options.interval] - Interval between rotations (default: MESSAGE_INTERVAL)
 * @returns {Object} Rotator controller with start, stop, and setMessages methods
 */
export function createMessageRotator({
  onUpdate,
  interval = MESSAGE_INTERVAL,
} = {}) {
  let messages = [];
  let currentIndex = 0;
  let timer = null;
  let currentInterval = interval;
  let loop = false;

  const rotate = () => {
    if (currentIndex >= messages.length) {
      // A looping list fills a phase of unknown length (parsing a file, where
      // the next real event may be half a minute away); a one-shot list holds
      // on its last message rather than repeating itself.
      if (!loop || messages.length === 0) return;
      currentIndex = 0;
    }
    onUpdate?.(messages[currentIndex]);
    currentIndex++;
    timer = setTimeout(rotate, currentInterval);
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

  /**
   * Replace the message list and rewind to its first message.
   *
   * @param {string[]} newMessages
   * @param {Object} [opts]
   * @param {number} [opts.interval] - Interval for this list; a short phase
   *   (parsing a file) rotates faster than a long one (writing sections).
   * @param {boolean} [opts.loop] - Start over at the end instead of holding on
   *   the last message.
   */
  const setMessages = (
    newMessages,
    { interval: nextInterval, loop: nextLoop = false } = {},
  ) => {
    messages = newMessages || [];
    currentIndex = 0;
    loop = Boolean(nextLoop);
    if (Number.isFinite(nextInterval) && nextInterval > 0) {
      currentInterval = nextInterval;
    }
  };

  return {
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
