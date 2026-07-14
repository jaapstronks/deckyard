/**
 * Status element helpers for consistent UI status messaging.
 * Reduces boilerplate for showing status updates, loading states, and errors.
 *
 * @example
 * const statusEl = createStatusElement(h, { class: 'help ui-status-line' });
 * container.append(statusEl.element);
 *
 * statusEl.set('Loading...');
 * statusEl.setError('Something went wrong');
 * statusEl.clear();
 */

/**
 * Create a status element with helper methods.
 *
 * @param {Function} h - DOM helper function (hyperscript-style)
 * @param {Object} [options={}] - Element options
 * @param {string} [options.class='help ui-status-line'] - CSS class(es)
 * @param {string} [options.tag='div'] - HTML tag name
 * @returns {Object} Status manager with element, set(), setError(), clear() methods
 */
export function createStatusElement(h, {
  class: className = 'help ui-status-line',
  tag = 'div',
} = {}) {
  const element = h(tag, { class: className });

  /**
   * Set status text.
   * @param {string} text - Status message
   */
  const set = (text) => {
    element.textContent = text || '';
    element.classList.remove('is-error');
  };

  /**
   * Set error status text (adds visual styling).
   * @param {string|Error} error - Error message or Error object
   */
  const setError = (error) => {
    element.textContent = String(error?.message || error || '');
    element.classList.add('is-error');
  };

  /**
   * Clear status text.
   */
  const clear = () => {
    element.textContent = '';
    element.classList.remove('is-error');
  };

  /**
   * Get current status text.
   * @returns {string}
   */
  const get = () => element.textContent;

  return {
    element,
    set,
    setError,
    clear,
    get,
  };
}

/**
 * Create a message rotator for long-running operations.
 * Shows a sequence of messages at regular intervals.
 *
 * @example
 * const rotator = createMessageRotator({
 *   messages: ['Analyzing...', 'Processing...', 'Almost done...'],
 *   interval: 5000,
 *   onMessage: (msg, index) => statusEl.set(msg),
 * });
 *
 * rotator.start();
 * await longOperation();
 * rotator.stop();
 *
 * @param {Object} options
 * @param {string[]} [options.messages=[]] - Messages to rotate through
 * @param {number} [options.interval=6500] - Interval between messages (ms)
 * @param {Function} [options.onMessage] - Callback for each message (msg, index)
 * @param {boolean} [options.loop=false] - Whether to loop messages
 * @returns {Object} Rotator with start(), stop(), setMessages() methods
 */
export function createMessageRotator({
  messages = [],
  interval = 6500,
  onMessage = null,
  loop = false,
} = {}) {
  let currentMessages = [...messages];
  let currentIndex = 0;
  let timerId = null;
  let running = false;

  const showCurrent = () => {
    if (currentIndex < currentMessages.length && typeof onMessage === 'function') {
      onMessage(currentMessages[currentIndex], currentIndex);
    }
  };

  const advance = () => {
    currentIndex++;
    if (currentIndex >= currentMessages.length) {
      if (loop) {
        currentIndex = 0;
      } else {
        stop();
        return;
      }
    }
    showCurrent();
    if (running) {
      timerId = setTimeout(advance, interval);
    }
  };

  const start = () => {
    if (running) return;
    running = true;
    currentIndex = 0;
    showCurrent();
    if (currentMessages.length > 1) {
      timerId = setTimeout(advance, interval);
    }
  };

  const stop = () => {
    running = false;
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  const setMessages = (newMessages) => {
    const wasRunning = running;
    stop();
    currentMessages = [...newMessages];
    currentIndex = 0;
    if (wasRunning && currentMessages.length > 0) {
      start();
    }
  };

  const isRunning = () => running;

  return {
    start,
    stop,
    setMessages,
    isRunning,
  };
}