export function createEdgeHint(edgeHintEl, { durationMs = 900 } = {}) {
  let tid = null;

  const show = (msg) => {
    try {
      if (tid) clearTimeout(tid);
    } catch {}
    edgeHintEl.textContent = String(msg || '').trim();
    edgeHintEl.classList.add('is-visible');
    tid = setTimeout(() => {
      edgeHintEl.classList.remove('is-visible');
      tid = null;
    }, durationMs);
  };

  const destroy = () => {
    try {
      if (tid) clearTimeout(tid);
    } catch {}
    tid = null;
    try {
      edgeHintEl.classList.remove('is-visible');
    } catch {}
  };

  return { show, destroy };
}
