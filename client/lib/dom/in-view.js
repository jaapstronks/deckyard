/**
 * Lazily run a callback the first time an element scrolls into (or near) the
 * viewport, using a single shared IntersectionObserver.
 *
 * Used by long grids (e.g. the deck list) to defer expensive per-item work —
 * rendering a live slide thumbnail — until the item is actually visible,
 * instead of doing it eagerly for every off-screen card on mount.
 *
 * Falls back to running every callback immediately when IntersectionObserver
 * is unavailable (old browsers, non-DOM test envs).
 */
export function createInViewLoader({ rootMargin = '400px 0px' } = {}) {
  const callbacks = new WeakMap();
  const supported = typeof IntersectionObserver === 'function';
  const observer = supported
    ? new IntersectionObserver(
        (entries, obs) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const el = entry.target;
            const fn = callbacks.get(el);
            callbacks.delete(el);
            obs.unobserve(el);
            if (typeof fn === 'function') fn();
          }
        },
        { rootMargin }
      )
    : null;

  return {
    /** Whether a real IntersectionObserver is backing this loader. */
    supported,

    /**
     * Run `fn` once when `el` enters view (or immediately if unsupported).
     * @param {Element} el - Element to watch.
     * @param {() => void} fn - Callback to run on first intersection.
     */
    observe(el, fn) {
      if (!el || typeof fn !== 'function') return;
      if (!observer) {
        fn();
        return;
      }
      callbacks.set(el, fn);
      observer.observe(el);
    },

    /** Stop observing every element and release the observer. */
    disconnect() {
      try {
        observer?.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}
