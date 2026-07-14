export function createTranslatingPoll({
  refreshPresentationIfLive,
  onUpdated,
  intervalMs = 1500,
} = {}) {
  let tid = null;
  let busy = false;

  const stop = () => {
    if (!tid) return;
    try {
      clearInterval(tid);
    } catch {}
    tid = null;
    busy = false;
  };

  const ensure = () => {
    if (tid) return;
    tid = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const ok = await refreshPresentationIfLive?.();
        if (ok) onUpdated?.();
      } catch {
        // ignore
      } finally {
        busy = false;
      }
    }, intervalMs);
    tid.unref?.();
  };

  return { ensure, stop };
}
