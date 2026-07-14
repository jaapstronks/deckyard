export function withBackoff(connectFn, { onStatus } = {}) {
  let stopped = false;
  let attempt = 0;
  let currentCleanup = null;

  const stop = () => {
    stopped = true;
    attempt = 0;
    if (typeof currentCleanup === 'function') {
      try {
        currentCleanup();
      } catch {}
    }
    currentCleanup = null;
  };

  const start = () => {
    const run = () => {
      if (stopped) return;
      const delay = Math.min(30_000, 600 * 2 ** attempt);
      if (attempt > 0)
        setTimeout(() => {
          if (!stopped) runNow();
        }, delay);
      else runNow();
    };
    const runNow = () => {
      if (stopped) return;
      attempt += 1;
      onStatus?.({ kind: 'connecting', attempt });
      try {
        currentCleanup = connectFn({
          onOpen: () => {
            attempt = 0;
            onStatus?.({ kind: 'open' });
          },
          onError: () => {
            onStatus?.({ kind: 'error' });
            if (typeof currentCleanup === 'function') {
              try {
                currentCleanup();
              } catch {}
            }
            currentCleanup = null;
            if (!stopped) run();
          },
        });
      } catch {
        onStatus?.({ kind: 'error' });
        if (!stopped) run();
      }
    };
    run();
  };

  return { start, stop };
}
