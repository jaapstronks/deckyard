function safeObj(v) {
  return v && typeof v === 'object' ? v : null;
}

function clamp0(n) {
  return Math.max(0, Number(n || 0) || 0);
}

export function createFollowInteractionLocalCache({
  readStoredVote,
  writeStoredVote,
  readStoredFeedback,
  writeStoredFeedback,
} = {}) {
  // Local per-device vote cache.
  // Reason: some refresh/SSE payloads are aggregate-only and may omit per-device fields like `myVote`.
  // If we fully trust those payloads, the UI can "flip" between voted/unvoted.
  const myVoteBySlideId = new Map(); // slideId -> optionIndex
  const myFeedbackBySlideId = new Map(); // slideId -> submitted text

  const getLocalVote = (slideId) => {
    const sid = String(slideId || '').trim();
    if (!sid) return null;
    if (myVoteBySlideId.has(sid)) return myVoteBySlideId.get(sid);
    const stored = readStoredVote?.(sid);
    if (stored == null) return null;
    myVoteBySlideId.set(sid, clamp0(stored));
    return clamp0(stored);
  };

  const setLocalVote = (slideId, v) => {
    const sid = String(slideId || '').trim();
    if (!sid) return;
    const n = v == null ? null : clamp0(v);
    if (n == null) myVoteBySlideId.delete(sid);
    else myVoteBySlideId.set(sid, n);
    writeStoredVote?.(sid, n);
  };

  const getLocalFeedback = (slideId) => {
    const sid = String(slideId || '').trim();
    if (!sid) return '';
    if (myFeedbackBySlideId.has(sid)) return myFeedbackBySlideId.get(sid) || '';
    const stored = readStoredFeedback?.(sid);
    const t = stored ? String(stored).trim() : '';
    if (t) myFeedbackBySlideId.set(sid, t);
    return t;
  };

  const setLocalFeedback = (slideId, text) => {
    const sid = String(slideId || '').trim();
    if (!sid) return;
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) myFeedbackBySlideId.delete(sid);
    else myFeedbackBySlideId.set(sid, t);
    writeStoredFeedback?.(sid, t);
  };

  const applyLocalVoteToState = (slideId, st) => {
    const sid = String(slideId || '').trim();
    if (!sid) return st;
    const local = getLocalVote(sid);
    if (local == null) return st;
    const base = safeObj(st) || {};
    return { ...base, myVote: local };
  };

  const applyLocalFeedbackToState = (slideId, st) => {
    const sid = String(slideId || '').trim();
    if (!sid) return st;
    const local = getLocalFeedback(sid);
    if (!local) return st;
    const base = safeObj(st) || {};
    if (typeof base?.myText === 'string' && base.myText.trim()) return base;
    return { ...base, myText: local };
  };

  return {
    getLocalVote,
    setLocalVote,
    getLocalFeedback,
    setLocalFeedback,
    applyLocalVoteToState,
    applyLocalFeedbackToState,
  };
}
