/**
 * Loading Modal
 *
 * A slick loading modal with blur background and animated status messages.
 * Used during AI generation for better UX.
 */

/**
 * Create and show a loading modal
 *
 * @param {Object} options
 * @param {Function} options.h - Element helper function
 * @param {HTMLElement} options.root - Root element to append to
 * @param {string} options.initialMessage - Initial status message
 * @param {string} options.title - Modal title (optional)
 * @returns {Object} Controller with update(), setProgress(), close() methods
 */
export function showLoadingModal({ h, root, initialMessage = '', title = '' } = {}) {
  // Create backdrop with blur
  const backdrop = h('div', { class: 'loading-modal-backdrop' });

  // Create modal
  const modal = h('div', { class: 'loading-modal' });

  // Spinner animation
  const spinnerWrap = h('div', { class: 'loading-modal-spinner' });
  const spinnerSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  spinnerSvg.setAttribute('viewBox', '0 0 50 50');
  spinnerSvg.setAttribute('class', 'loading-spinner-svg');
  const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  circle.setAttribute('cx', '25');
  circle.setAttribute('cy', '25');
  circle.setAttribute('r', '20');
  circle.setAttribute('fill', 'none');
  circle.setAttribute('stroke', 'currentColor');
  circle.setAttribute('stroke-width', '4');
  circle.setAttribute('stroke-linecap', 'round');
  circle.setAttribute('class', 'loading-spinner-circle');
  spinnerSvg.appendChild(circle);
  spinnerWrap.appendChild(spinnerSvg);

  // Title (optional)
  const titleEl = h('div', {
    class: 'loading-modal-title',
    text: title || '',
  });
  if (!title) titleEl.style.display = 'none';

  // Status message
  const messageEl = h('div', {
    class: 'loading-modal-message',
    text: initialMessage || '',
  });

  // Progress bar
  const progressWrap = h('div', { class: 'loading-modal-progress-wrap' });
  const progressBar = h('div', { class: 'loading-modal-progress-bar' });
  progressBar.style.width = '0%';
  progressWrap.appendChild(progressBar);

  // Progress text
  const progressText = h('div', { class: 'loading-modal-progress-text' });

  // Assemble
  modal.append(spinnerWrap, titleEl, messageEl, progressWrap, progressText);
  backdrop.appendChild(modal);
  root.appendChild(backdrop);

  // Animate in
  requestAnimationFrame(() => {
    backdrop.classList.add('is-visible');
  });

  let currentMessage = initialMessage;
  let messageQueue = [];
  let isTransitioning = false;

  /**
   * Update the status message with animation
   */
  const updateMessage = (newMessage) => {
    if (!newMessage || newMessage === currentMessage) return;

    if (isTransitioning) {
      // Queue the message
      messageQueue.push(newMessage);
      return;
    }

    isTransitioning = true;
    currentMessage = newMessage;

    // Fade out
    messageEl.classList.add('is-fading');

    setTimeout(() => {
      messageEl.textContent = newMessage;
      messageEl.classList.remove('is-fading');
      messageEl.classList.add('is-appearing');

      setTimeout(() => {
        messageEl.classList.remove('is-appearing');
        isTransitioning = false;

        // Process queued message if any
        if (messageQueue.length > 0) {
          const next = messageQueue.shift();
          // Clear any older queued messages, only show latest
          if (messageQueue.length > 0) {
            messageQueue = [messageQueue[messageQueue.length - 1]];
          }
          updateMessage(next);
        }
      }, 300);
    }, 200);
  };

  /**
   * Set progress (0-100)
   */
  const setProgress = (percent) => {
    const clamped = Math.max(0, Math.min(100, percent));
    progressBar.style.width = `${clamped}%`;
    progressText.textContent = `${Math.round(clamped)}%`;
  };

  /**
   * Close the modal with animation
   */
  const close = () => {
    backdrop.classList.remove('is-visible');
    backdrop.classList.add('is-closing');

    setTimeout(() => {
      backdrop.remove();
    }, 300);
  };

  /**
   * Set the title
   */
  const setTitle = (newTitle) => {
    titleEl.textContent = newTitle || '';
    titleEl.style.display = newTitle ? '' : 'none';
  };

  return {
    update: updateMessage,
    setProgress,
    setTitle,
    close,
    element: backdrop,
  };
}

/**
 * Show a loading modal and run a promise, auto-closing on completion
 *
 * @param {Object} options
 * @param {Function} options.h - Element helper
 * @param {HTMLElement} options.root - Root element
 * @param {Promise} options.promise - The promise to wait for
 * @param {string} options.initialMessage - Initial message
 * @param {string} options.successMessage - Message on success (shown briefly)
 * @returns {Promise} Resolves with the promise result
 */
export async function withLoadingModal({
  h,
  root,
  promise,
  initialMessage = 'Loading...',
  successMessage = 'Done!',
  title = '',
} = {}) {
  const modal = showLoadingModal({ h, root, initialMessage, title });

  try {
    const result = await promise;
    modal.update(successMessage);
    modal.setProgress(100);

    await new Promise((r) => setTimeout(r, 800));
    modal.close();

    return result;
  } catch (e) {
    modal.close();
    throw e;
  }
}