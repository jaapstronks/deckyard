import { storage } from '../../../lib/storage.js';

function clamp0(n) {
  return Math.max(0, Number(n || 0) || 0);
}

export function createFollowInteractionStorage({ presentationId } = {}) {
  const VOTE_STORAGE_PREFIX = 'ps.follow.vote.v1';
  const FEEDBACK_STORAGE_PREFIX = 'ps.follow.feedback.v1';
  const FEEDBACK_DRAFT_PREFIX = 'ps.follow.feedback.draft.v1';

  const voteStorageKey = (slideId) => {
    const pid = String(presentationId || '').trim();
    const sid = String(slideId || '').trim();
    if (!pid || !sid) return '';
    return `${VOTE_STORAGE_PREFIX}.${pid}.${sid}`;
  };

  const feedbackStorageKey = (slideId) => {
    const pid = String(presentationId || '').trim();
    const sid = String(slideId || '').trim();
    if (!pid || !sid) return '';
    return `${FEEDBACK_STORAGE_PREFIX}.${pid}.${sid}`;
  };

  const feedbackDraftKey = (slideId) => {
    const pid = String(presentationId || '').trim();
    const sid = String(slideId || '').trim();
    if (!pid || !sid) return '';
    return `${FEEDBACK_DRAFT_PREFIX}.${pid}.${sid}`;
  };

  const readStoredVote = (slideId) => {
    const key = voteStorageKey(slideId);
    if (!key) return null;
    const raw = storage.get(key, null);
    if (raw == null) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return clamp0(n);
  };

  const writeStoredVote = (slideId, v) => {
    const key = voteStorageKey(slideId);
    if (!key) return;
    if (v == null) storage.remove(key);
    else storage.set(key, String(clamp0(v)));
  };

  const readStoredFeedback = (slideId) => {
    const key = feedbackStorageKey(slideId);
    if (!key) return null;
    const raw = storage.get(key, null);
    if (raw == null) return null;
    const t = String(raw || '').trim();
    return t ? t : null;
  };

  const writeStoredFeedback = (slideId, text) => {
    const key = feedbackStorageKey(slideId);
    if (!key) return;
    const t = typeof text === 'string' ? text.trim() : '';
    if (!t) storage.remove(key);
    else storage.set(key, t);
  };

  // Note: Draft feedback uses sessionStorage (not localStorage), so no migration needed
  const readDraftFeedback = (slideId) => {
    const key = feedbackDraftKey(slideId);
    if (!key) return '';
    try {
      const raw = sessionStorage.getItem(key);
      return typeof raw === 'string' ? raw : '';
    } catch {
      return '';
    }
  };

  const writeDraftFeedback = (slideId, text) => {
    const key = feedbackDraftKey(slideId);
    if (!key) return;
    try {
      const t = typeof text === 'string' ? text : '';
      if (!t) sessionStorage.removeItem(key);
      else sessionStorage.setItem(key, t);
    } catch {
      // ignore
    }
  };

  return {
    readStoredVote,
    writeStoredVote,
    readStoredFeedback,
    writeStoredFeedback,
    readDraftFeedback,
    writeDraftFeedback,
  };
}
