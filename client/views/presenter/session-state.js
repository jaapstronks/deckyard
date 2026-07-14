export function createSessionStatePoster({
  api,
  getSessionId,
  getSessionPresentationId,
  getCurrentSlide,
  getCurrentIndex,
  getStepParagraphs,
} = {}) {
  let postingState = false;
  let pendingPostedState = null;

  const postSessionState = (partial) => {
    const current = getCurrentSlide?.();
    const sessionId = getSessionId?.();
    const sessionPresId = getSessionPresentationId?.();
    if (!sessionId || !sessionPresId || !current) return;

    pendingPostedState = {
      presentationId: sessionPresId,
      slideId:
        typeof partial?.slideId === 'string' ? partial.slideId : current.id,
      slideIndex:
        Number.isFinite(Number(partial?.slideIndex))
          ? Number(partial.slideIndex)
          : Number(getCurrentIndex?.() ?? 0) || 0,
      slideType:
        typeof partial?.slideType === 'string'
          ? partial.slideType
          : String(current?.type || ''),
      stepIdx: Math.max(0, Number(partial?.stepIdx || 0) || 0),
      stepParagraphs:
        typeof partial?.stepParagraphs === 'boolean'
          ? partial.stepParagraphs
          : !!getStepParagraphs?.(),
      updatedAt: Date.now(),
    };

    if (postingState) return;
    postingState = true;

    const drain = async () => {
      while (pendingPostedState) {
        const payload = pendingPostedState;
        pendingPostedState = null;
        // eslint-disable-next-line no-await-in-loop
        await api(`/api/present-sessions/${sessionId}/state`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }).catch(() => {});
      }
    };

    drain()
      .catch(() => {})
      .finally(() => {
        postingState = false;
        if (pendingPostedState) postSessionState(pendingPostedState);
      });
  };

  return { postSessionState };
}
