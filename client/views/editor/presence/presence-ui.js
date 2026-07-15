/**
 * Presence UI for the editor: avatar stack (topbar), per-slide indicators in
 * the slide list, and field-focus outlines on the preview canvas.
 *
 * Pure view layer over a presence session (client/lib/collab/presence-session.js).
 * Slide-list items and the preview slide are re-rendered destructively by the
 * editor, so decorations are (re)applied from the current peer list via
 * MutationObservers — never stored in the DOM as the source of truth.
 */

import { createAvatar } from '../../../lib/avatar.js';
import { displayNameFromEmail } from '../../../lib/user-format.js';
import { t } from '../../../lib/ui-i18n.js';

const MAX_STACK_AVATARS = 5;

/** @param {Object} peer @returns {string} display name for tooltips/labels */
function peerName(peer) {
  return peer?.user?.name || displayNameFromEmail(peer?.user?.email || '');
}

/** Dedupe peers by email (multiple tabs of one user collapse into one). */
function uniqueByEmail(peers) {
  const seen = new Map();
  for (const p of peers) {
    if (!seen.has(p.user.email)) seen.set(p.user.email, p);
  }
  return [...seen.values()];
}

/**
 * Mount the presence UI.
 *
 * @param {Object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Object} opts.session - presence session
 * @param {HTMLElement} opts.topbarEl - editor topbar root
 * @param {HTMLElement} opts.listEl - slide list container (.slides-panel .list)
 * @param {HTMLElement} opts.thumb - preview slide container
 * @param {Function} opts.getSelectedSlideId - () => current slide id
 * @returns {{ destroy: Function }}
 */
export function createPresenceUI({
  h,
  session,
  topbarEl,
  listEl,
  thumb,
  getSelectedSlideId,
}) {
  const detachers = [];

  // ============================================================
  // TOPBAR AVATAR STACK
  // ============================================================

  const stackEl = h('div', {
    class: 'collab-presence-stack',
    role: 'group',
    'aria-label': t('editor.presence.here', 'Also here'),
  });
  const spacer = topbarEl?.querySelector?.('.topbar-spacer');
  (spacer || topbarEl)?.append(stackEl);
  detachers.push(() => stackEl.remove());

  function renderStack(peers) {
    stackEl.textContent = '';
    const unique = uniqueByEmail(peers);
    stackEl.style.display = unique.length ? '' : 'none';
    for (const peer of unique.slice(0, MAX_STACK_AVATARS)) {
      const wrap = h('div', {
        class: 'collab-presence-avatar',
        style: `--presence-color: ${peer.user.color}`,
        title: t('editor.presence.viewerTitle', '{name} is in this deck', {
          name: peerName(peer),
        }),
      });
      wrap.append(
        createAvatar({ email: peer.user.email, name: peer.user.name, size: 'sm' })
      );
      stackEl.append(wrap);
    }
    if (unique.length > MAX_STACK_AVATARS) {
      stackEl.append(
        h('div', {
          class: 'collab-presence-more',
          text: `+${unique.length - MAX_STACK_AVATARS}`,
          title: unique
            .slice(MAX_STACK_AVATARS)
            .map((p) => peerName(p))
            .join(', '),
        })
      );
    }
  }

  // ============================================================
  // SLIDE LIST INDICATORS
  // ============================================================

  let applying = false;

  function applySlideIndicators(peers) {
    if (!listEl) return;
    applying = true;
    try {
      for (const old of listEl.querySelectorAll('.collab-slide-presence'))
        old.remove();

      // Group peers per viewed slide (dedupe by email within a slide).
      const bySlide = new Map();
      for (const peer of uniqueByEmail(peers)) {
        const slideId = peer.view?.slideId;
        if (!slideId) continue;
        if (!bySlide.has(slideId)) bySlide.set(slideId, []);
        bySlide.get(slideId).push(peer);
      }

      for (const [slideId, slidePeers] of bySlide) {
        const item = listEl.querySelector(
          `.slide-item[data-slide-id="${CSS.escape(slideId)}"]`
        );
        if (!item) continue;
        const badge = h('div', { class: 'collab-slide-presence' });
        for (const peer of slidePeers.slice(0, 3)) {
          const isEditing = peer.focus?.slideId === slideId;
          badge.append(
            h('span', {
              class: `collab-slide-dot${isEditing ? ' is-editing' : ''}`,
              style: `--presence-color: ${peer.user.color}`,
              title: isEditing
                ? t('editor.presence.editingSlide', '{name} is editing this slide', { name: peerName(peer) })
                : t('editor.presence.viewingSlide', '{name} is viewing this slide', { name: peerName(peer) }),
            })
          );
        }
        item.append(badge);
      }
    } finally {
      applying = false;
    }
  }

  // Slide-list re-renders wipe the items; re-apply when that happens.
  const listObserver = new MutationObserver(() => {
    if (applying) return;
    scheduleRefresh();
  });
  if (listEl) listObserver.observe(listEl, { childList: true });
  detachers.push(() => listObserver.disconnect());

  // ============================================================
  // FIELD-FOCUS OUTLINES (preview canvas)
  // ============================================================

  // The slide renders at 1600x900 and is transform-scaled inside the thumb,
  // so any in-slide border would read as microscopic (same reason the
  // inline-edit affordances use an overlay). Focus rings + name labels are
  // therefore absolutely positioned thumb children at real screen pixels.
  function applyFieldOutlines(peers) {
    if (!thumb) return;
    applying = true;
    try {
      for (const el of thumb.querySelectorAll('.collab-focus-ring, .collab-focus-label'))
        el.remove();

      const selectedId = getSelectedSlideId?.();
      if (!selectedId) return;

      const thumbRect = thumb.getBoundingClientRect();
      for (const peer of peers) {
        const focus = peer.focus;
        if (!focus || focus.slideId !== selectedId || !focus.fieldPath) continue;
        const el = thumb.querySelector(
          `[data-inline-field="${CSS.escape(focus.fieldPath)}"]`
        );
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const ring = h('div', {
          class: 'collab-focus-ring',
          style: `--presence-color: ${peer.user.color}`,
          'aria-hidden': 'true',
        });
        ring.style.left = `${rect.left - thumbRect.left - 3}px`;
        ring.style.top = `${rect.top - thumbRect.top - 3}px`;
        ring.style.width = `${rect.width + 6}px`;
        ring.style.height = `${rect.height + 6}px`;
        const label = h('span', {
          class: 'collab-focus-label',
          text: peerName(peer),
          style: `--presence-color: ${peer.user.color}`,
          'aria-hidden': 'true',
        });
        thumb.append(ring, label);
        label.style.left = `${rect.left - thumbRect.left - 3}px`;
        label.style.top = `${Math.max(0, rect.top - thumbRect.top - 3 - label.offsetHeight)}px`;
      }
    } finally {
      applying = false;
    }
  }

  // Preview re-renders wipe the slide DOM; re-apply outlines afterwards.
  const thumbObserver = new MutationObserver(() => {
    if (applying) return;
    scheduleRefresh();
  });
  if (thumb) thumbObserver.observe(thumb, { childList: true });
  detachers.push(() => thumbObserver.disconnect());

  // ============================================================
  // OWN FOCUS REPORTING (inline-edit fields carry data-inline-field)
  // ============================================================

  let blurTimer = null;
  const onFocusIn = (e) => {
    const field = e.target?.closest?.('[data-inline-field]');
    if (!field) return;
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
    session.setFocusField(
      getSelectedSlideId?.() || null,
      field.getAttribute('data-inline-field')
    );
  };
  const onFocusOut = () => {
    // Small delay so hopping between fields doesn't flicker through null.
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      blurTimer = null;
      session.setFocusField(null, null);
    }, 150);
  };
  if (thumb) {
    thumb.addEventListener('focusin', onFocusIn);
    thumb.addEventListener('focusout', onFocusOut);
    detachers.push(() => {
      thumb.removeEventListener('focusin', onFocusIn);
      thumb.removeEventListener('focusout', onFocusOut);
      if (blurTimer) clearTimeout(blurTimer);
    });
  }

  // ============================================================
  // REFRESH PIPELINE
  // ============================================================

  let refreshQueued = false;
  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refresh();
    });
  }

  function refresh() {
    const peers = session.getPeers();
    renderStack(peers);
    applySlideIndicators(peers);
    applyFieldOutlines(peers);
  }

  const offPeers = session.onPeersChange(() => scheduleRefresh());
  detachers.push(offPeers);
  refresh();

  return {
    refresh: scheduleRefresh,
    destroy() {
      for (const d of detachers) {
        try {
          d();
        } catch {
          // ignore
        }
      }
    },
  };
}
