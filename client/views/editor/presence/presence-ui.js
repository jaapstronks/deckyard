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

/**
 * Dedupe peers by email (multiple tabs of one user collapse into one).
 * A connection that is actively editing wins over an idle one — otherwise a
 * user's forgotten background tab pins their slide-list dot to whatever
 * slide it was left on while they visibly edit elsewhere.
 */
function uniqueByEmail(peers) {
  const seen = new Map();
  for (const p of peers) {
    const kept = seen.get(p.user.email);
    if (!kept || (!kept.focus && p.focus)) seen.set(p.user.email, p);
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
 * @param {HTMLElement} [opts.editorMount] - side-form root (re-applies form
 *   field decorations after the form re-renders)
 * @param {Function} opts.getSelectedSlideId - () => current slide id
 * @returns {{ destroy: Function }}
 */
export function createPresenceUI({
  h,
  session,
  topbarEl,
  listEl,
  thumb,
  editorMount,
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

  // Re-renders wipe the decorations; re-apply when that happens. The
  // observers must ignore the decorations' own add/remove churn: their
  // callbacks are delivered asynchronously (after `applying` has been reset),
  // so without this filter a visible ring re-triggers refresh() from its own
  // mutations in an endless rAF loop.
  const isPresenceNode = (n) =>
    n instanceof HTMLElement &&
    (n.classList.contains('collab-focus-ring') ||
      n.classList.contains('collab-focus-label') ||
      n.classList.contains('collab-slide-presence'));
  const onDomMutations = (mutations) => {
    if (applying) return;
    for (const m of mutations) {
      for (const n of [...m.addedNodes, ...m.removedNodes]) {
        if (!isPresenceNode(n)) {
          scheduleRefresh();
          return;
        }
      }
    }
  };

  // Slide-list re-renders wipe the items; re-apply when that happens.
  const listObserver = new MutationObserver(onDomMutations);
  if (listEl) listObserver.observe(listEl, { childList: true });
  detachers.push(() => listObserver.disconnect());

  // ============================================================
  // FIELD-FOCUS OUTLINES (preview canvas + flat editing surfaces)
  // ============================================================

  // The slide renders at 1600x900 and is transform-scaled inside the thumb,
  // so any in-slide border would read as microscopic (same reason the
  // inline-edit affordances use an overlay). Focus rings + name labels are
  // therefore absolutely positioned thumb children at real screen pixels.
  //
  // Flat (unscaled) editing surfaces — side-form field wrappers, the
  // presenter-notes textarea and the inline markdown modal — carry a
  // `data-collab-field-key` attribute instead and are decorated with a CSS
  // class (outline + name chip via ::after).
  function applyFieldOutlines(peers) {
    if (!thumb) return;
    applying = true;
    try {
      for (const el of thumb.querySelectorAll('.collab-focus-ring, .collab-focus-label'))
        el.remove();
      for (const el of document.querySelectorAll('.collab-remote-focus')) {
        el.classList.remove('collab-remote-focus');
        delete el.dataset.collabFocusName;
      }

      const selectedId = getSelectedSlideId?.();
      if (!selectedId) return;

      const thumbRect = thumb.getBoundingClientRect();
      for (const peer of peers) {
        const focus = peer.focus;
        if (!focus || focus.slideId !== selectedId || !focus.fieldPath) continue;

        // Flat surfaces: mark every element bound to this field key (the
        // side-form wrapper, the notes textarea's block, a matching open
        // markdown modal). Inputs/textareas can't host ::after, so the
        // decoration lands on their parent block.
        for (const bound of document.querySelectorAll(
          `[data-collab-field-key="${CSS.escape(focus.fieldPath)}"]`
        )) {
          const target =
            bound instanceof HTMLTextAreaElement || bound instanceof HTMLInputElement
              ? bound.parentElement
              : bound;
          if (!target) continue;
          target.classList.add('collab-remote-focus');
          target.style.setProperty('--presence-color', peer.user.color);
          target.dataset.collabFocusName = peerName(peer);
        }

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
        // The label floats 7px above the ring; a ::after pin line spans the
        // gap (see 107-collab-presence.css). Clamped into the thumb when the
        // field sits at the very top.
        label.style.left = `${rect.left - thumbRect.left - 3}px`;
        label.style.top = `${Math.max(0, rect.top - thumbRect.top - 3 - 7 - label.offsetHeight)}px`;
      }
    } finally {
      applying = false;
    }
  }

  // Preview re-renders wipe the slide DOM; re-apply outlines afterwards.
  const thumbObserver = new MutationObserver(onDomMutations);
  if (thumb) thumbObserver.observe(thumb, { childList: true });
  detachers.push(() => thumbObserver.disconnect());

  // Side-form rebuilds wipe the field-wrapper decorations the same way.
  const formObserver = new MutationObserver(onDomMutations);
  if (editorMount) formObserver.observe(editorMount, { childList: true });
  detachers.push(() => formObserver.disconnect());

  // ============================================================
  // OWN FOCUS REPORTING
  // ============================================================

  // Every collaborative editing surface is recognizable from the DOM: canvas
  // WYSIWYG fields carry `data-inline-field`, and side-form wrappers, the
  // presenter-notes textarea and the inline markdown modal carry
  // `data-collab-field-key` (same path vocabulary). The reported state is
  // always DERIVED from document.activeElement — never incrementally tracked
  // off individual focus events — so a missed focusout (Safari quirks,
  // elements removed while focused by a re-render) can't leave a stale
  // "still editing" ring behind on peers; refresh() re-derives as a backstop.
  function ownFieldPath() {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const inline = el.closest?.('[data-inline-field]');
    if (inline) return inline.getAttribute('data-inline-field');
    const keyed = el.closest?.('[data-collab-field-key]');
    if (keyed) return keyed.getAttribute('data-collab-field-key');
    return null;
  }

  let reportedPath = null;
  let blurTimer = null;
  function reportOwnFocus() {
    const path = ownFieldPath();
    if (path) {
      if (blurTimer) {
        clearTimeout(blurTimer);
        blurTimer = null;
      }
      if (path !== reportedPath) {
        reportedPath = path;
        session.setFocusField(getSelectedSlideId?.() || null, path);
      }
      return;
    }
    if (reportedPath === null || blurTimer) return;
    // Small delay so hopping between fields doesn't flicker through null;
    // the timer re-derives instead of blindly clearing.
    blurTimer = setTimeout(() => {
      blurTimer = null;
      const now = ownFieldPath();
      reportedPath = now;
      session.setFocusField(now ? getSelectedSlideId?.() || null : null, now);
    }, 150);
  }
  document.addEventListener('focusin', reportOwnFocus);
  document.addEventListener('focusout', reportOwnFocus);
  detachers.push(() => {
    document.removeEventListener('focusin', reportOwnFocus);
    document.removeEventListener('focusout', reportOwnFocus);
    if (blurTimer) clearTimeout(blurTimer);
  });

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
    // Self-heal the reported own-focus first: re-renders can remove a
    // focused element without firing focusout.
    reportOwnFocus();
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
