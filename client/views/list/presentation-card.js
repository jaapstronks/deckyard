import { h } from '../../lib/dom.js';
import { createInViewLoader } from '../../lib/dom/in-view.js';
import { toast } from '../../lib/dom/toast.js';
import { confirmModal } from '../../lib/dom/modal.js';
import { displayNameFromEmail } from '../../lib/user/user-format.js';
import { formatRelativeTime } from '../../lib/format/format-time.js';
import { t } from '../../lib/ui-i18n.js';
import { createAvatar } from '../../lib/user/avatar.js';
import { getUserProfile } from '../../lib/user/user-profiles.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { hexToRgb, getRelativeLuminance } from '../../../shared/color-utils.js';

// Safety-net window: if a card's thumbnail hasn't reached any terminal state
// within this long, force one. Comfortably longer than the single onerror
// retry (2500ms + two image loads) so it never preempts a legitimately slow
// generation, but short enough that a genuinely stuck shimmer doesn't outstay
// its welcome.
const THUMB_SETTLE_TIMEOUT_MS = 8000;

/**
 * Creates a presentation card renderer with shared context
 * @param {Object} ctx - Context with dependencies and callbacks
 * @returns {Object} Card renderer utilities
 */
export function createCardRenderer({
  api,
  nav,
  onDeckDuplicated,
  onTrashRefresh,
  detachThumbs,
  selectionState = null,
}) {
  // Defer thumbnail rendering until each card scrolls into view, so opening the
  // list doesn't synchronously render a live slide (theme load + full slide DOM)
  // for every off-screen deck. One shared observer for the whole list.
  const thumbLoader = createInViewLoader({ rootMargin: '400px 0px' });

  // One shared, bounded registry of the cards' still-pending thumbnail timers
  // (onerror retry + the safety net). Cards add a timer on arm and drop it when
  // it fires or the card settles, so this set never grows across re-renders —
  // unlike the old approach of pushing a fresh cleanup closure into
  // `detachThumbs` per card, which leaked one entry on every render.
  const pendingThumbTimers = new Set();
  detachThumbs.push(() => {
    for (const id of pendingThumbTimers) clearTimeout(id);
    pendingThumbTimers.clear();
    thumbLoader.disconnect();
  });

  const authorEmailForPresentation = (p) =>
    String(p?.updatedBy || p?.createdBy || p?.ownerEmail || '').trim();

  const openPresentation = (id) => nav?.(`/app/${id}`);
  const openPresenter = (id) => nav?.(`/present/${id}`);

  /**
   * Render a presentation card
   * @param {Object} p - Presentation data
   * @param {Object} options - Render options
   * @param {boolean} [options.isOrganization] - Is this a workspace presentation
   * @param {boolean} [options.highlight] - Highlight the card
   * @param {boolean} [options.isSharedWithMe] - Is this from "Shared with me"
   * @param {boolean} [options.isTrashView] - Is this in the trash view
   * @param {string} [options.sharedBy] - Email of the person who shared it
   * @param {string} [options.permission] - Permission level (view, comment, edit)
   * @returns {HTMLElement} Card element
   */
  const renderCard = (p, { isOrganization, highlight = false, isSharedWithMe = false, isTrashView = false, sharedBy, permission } = {}) => {
    // Check if selection mode is active
    const isSelectionMode = () => selectionState?.isActive?.() ?? false;
    const isSelected = () => selectionState?.isSelected?.(p.id) ?? false;

    const item = h('div', {
      class: `list-item presentation-card${isTrashView ? ' is-trashed' : ''}`,
      tabindex: '0',
      'data-id': p.id,
      onclick: (e) => {
        if (e?.target?.closest?.('button,a,.presentation-card-checkbox')) return;
        // In selection mode, toggle selection instead of opening
        if (isSelectionMode()) {
          selectionState?.toggle?.(p.id, p);
          updateSelectionState();
          return;
        }
        // Don't open trashed presentations
        if (isTrashView) return;
        openPresentation(p.id);
      },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          // In selection mode, toggle selection
          if (isSelectionMode()) {
            selectionState?.toggle?.(p.id, p);
            updateSelectionState();
            return;
          }
          // Don't open trashed presentations
          if (isTrashView) return;
          openPresentation(p.id);
        }
      },
    });

    // Update item selection state
    const updateSelectionState = () => {
      item.classList.toggle('is-selected', isSelected());
      item.classList.toggle('is-selection-mode', isSelectionMode());
      if (checkbox) {
        checkbox.checked = isSelected();
      }
    };

    // Create checkbox for selection
    const checkbox = h('input', {
      type: 'checkbox',
      class: 'presentation-card-checkbox',
      'aria-label': t('list.select', 'Select presentation'),
      onclick: (e) => {
        e.stopPropagation();
        selectionState?.toggle?.(p.id, p);
        updateSelectionState();
      },
    });

    // Store reference to update function for external updates
    item._updateSelection = updateSelectionState;

    // Skeleton shimmer until the PNG thumbnail loads (or the card scrolls into
    // view). Fase B: the list no longer renders a live slide DOM per card — it
    // lazy-loads a server-rasterized PNG→WebP of slide 1 and falls back to a
    // cheap title placeholder when none exists yet (never blank).
    const thumb = h('div', { class: 'thumb is-loading' });

    // "The shimmer always lands somewhere" is a guarantee, not a lucky property
    // of the happy path. Every terminal state (image, placeholder, "no slides")
    // routes through `settle()`, which flips this flag and cancels the card's
    // pending timers; a safety-net timer armed below forces a terminal state if
    // nothing else does.
    let settled = false;
    const cardTimers = new Set();
    // Arm a timeout tracked in both the card's own set and the renderer-wide
    // one, self-removing when it fires, so neither set outlives the timer. The
    // unref keeps a leftover fallback timer from holding a Node process open in
    // tests (no-op in the browser, where setTimeout returns a number).
    const arm = (fn, ms) => {
      const id = setTimeout(() => {
        cardTimers.delete(id);
        pendingThumbTimers.delete(id);
        fn();
      }, ms);
      if (typeof id?.unref === 'function') id.unref();
      cardTimers.add(id);
      pendingThumbTimers.add(id);
      return id;
    };
    const settle = () => {
      settled = true;
      for (const id of cardTimers) {
        clearTimeout(id);
        pendingThumbTimers.delete(id);
      }
      cardTimers.clear();
    };

    const showEmpty = () => {
      settle();
      thumb.classList.remove('is-loading');
      thumb.innerHTML = '';
      thumb.append(
        h('div', {
          class: 'help thumb-overlay is-muted',
          text: t('list.thumb.empty', 'No slides yet'),
        })
      );
    };

    // Cheap fallback while no raster exists (generation pending, disabled, or
    // failed): the deck title on the theme's own background color (or a neutral
    // surface when unknown). Deliberately not a live slide render — speed is
    // the whole point of Fase B.
    const showPlaceholder = () => {
      settle();
      thumb.classList.remove('is-loading');
      thumb.classList.add('is-placeholder');
      thumb.innerHTML = '';
      const titleEl = h('div', {
        class: 'thumb-placeholder-title',
        text: p.title || t('list.untitled', 'Untitled'),
      });
      if (p.thumbBg) {
        // Tint the card in the deck's theme color and pick a legible text color.
        thumb.style.background = p.thumbBg;
        titleEl.style.color = readableTextColor(p.thumbBg);
      } else {
        thumb.style.background = '';
      }
      thumb.append(titleEl);
    };

    const showThumbImage = () => {
      // `?v=<revision>` busts the cache on every deck edit.
      const thumbUrl = `/api/presentations/${p.id}/thumbnail?v=${p.revision || 1}`;
      const img = h('img', {
        class: 'thumb-img',
        alt: '',
        loading: 'lazy',
        decoding: 'async',
      });
      let retried = false;
      img.onload = () => {
        settle();
        thumb.classList.remove('is-loading', 'is-placeholder');
        thumb.innerHTML = '';
        thumb.append(img);
      };
      img.onerror = () => {
        // A 404 means generation is likely still in flight — retry once, then
        // settle on the placeholder.
        if (!retried) {
          retried = true;
          arm(() => {
            img.src = `${thumbUrl}&r=${Date.now()}`;
          }, 2500);
          return;
        }
        showPlaceholder();
      };
      img.src = thumbUrl;
    };

    // p.hasSlides tells us cheaply whether the deck has any slide, so empty
    // decks skip the network round-trip entirely. Render lazily, once the card
    // is near the viewport.
    thumbLoader.observe(thumb, () => {
      if (!p.hasSlides) {
        showEmpty();
        return;
      }
      showThumbImage();
    });

    // Safety net: the skeleton must never spin forever. If none of the terminal
    // paths ran within the grace window — the IntersectionObserver callback
    // never fired for this card, a thumbnail response resolved neither `load`
    // nor `error` (a 204, or a 200 whose body won't decode as an image), or
    // generation simply never completed — force a real end state. A card that
    // only scrolls into view later still upgrades: showThumbImage's onload
    // swaps the real raster in over the placeholder.
    arm(() => {
      if (settled) return;
      if (p.hasSlides) showPlaceholder();
      else showEmpty();
    }, THUMB_SETTLE_TIMEOUT_MS);

    const authorEmail = authorEmailForPresentation(p);
    const profile = authorEmail ? getUserProfile(authorEmail) : null;
    const authorName = profile?.name || displayNameFromEmail(authorEmail);
    const when = formatRelativeTime(p?.modified, t);

    // Create avatar with profile image support
    const avatar = createAvatar({
      imageUrl: profile?.imageUrl || '',
      email: authorEmail,
      name: authorName,
      size: 'sm',
      className: 'presentation-avatar',
    });

    // More actions menu (inline with title)
    const moreBtn = h('button', {
      class: 'presentation-card-more',
      type: 'button',
      title: t('list.moreActions', 'More actions'),
      text: '\u22EF', // horizontal ellipsis
      onclick: (e) => {
        e.stopPropagation();
        const willOpen = !menu.classList.contains('is-open');
        menu.classList.toggle('is-open');
        // Only listen for outside clicks while the menu is actually open.
        if (willOpen) document.addEventListener('click', closeMenu);
        else document.removeEventListener('click', closeMenu);
      },
    });

    const menu = h('div', { class: 'presentation-card-menu' });

    if (isTrashView) {
      // Trash view: Restore and Delete permanently buttons
      const menuRestore = h('button', {
        class: 'presentation-card-menu-item',
        type: 'button',
        text: t('list.restore', 'Restore'),
        onclick: async (e) => {
          e.stopPropagation();
          menu.classList.remove('is-open');
          try {
            await api(`/api/presentations/${p.id}/restore`, {
              method: 'POST',
            });
            // Show toast with link to open the restored presentation
            const toastEl = h('span', {}, [
              h('span', { text: t('list.restore.done', 'Restored.') + ' ' }),
              h('a', {
                href: `/app/${p.id}`,
                text: t('list.restore.openLink', 'Open presentation'),
                style: 'color: inherit; text-decoration: underline; cursor: pointer;',
                onclick: (ev) => {
                  ev.preventDefault();
                  nav?.(`/app/${p.id}`);
                },
              }),
            ]);
            toast.success(toastEl, {
              id: 'list-restore',
              durationMs: 5000,
            });
            // Remove from trash list
            item.remove();
            onTrashRefresh?.();
          } catch (err) {
            toast.error(String(err?.message || err), { id: 'list-restore' });
          }
        },
      });

      const menuPermanentDelete = h('button', {
        class: 'presentation-card-menu-item is-danger',
        type: 'button',
        text: t('list.deletePermanently', 'Delete permanently'),
        onclick: async (e) => {
          e.stopPropagation();
          menu.classList.remove('is-open');
          if (
            !(await confirmModal(h, document.body, {
              title: t('list.deletePermanently', 'Delete permanently'),
              message: t('list.deletePermanentlyConfirm', 'Permanently delete "{title}"? This can\'t be undone.', {
                title: p.title,
              }),
              confirmLabel: t('list.deletePermanently', 'Delete permanently'),
              danger: true,
            }))
          )
            return;
          try {
            await api(`/api/presentations/${p.id}/permanent`, { method: 'DELETE' });
            toast.success(t('list.deletePermanently.done', 'Permanently deleted.'), {
              id: 'list-permanent-delete',
              durationMs: 1800,
            });
            // Remove from trash list
            item.remove();
          } catch (err) {
            toast.error(String(err?.message || err), { id: 'list-permanent-delete' });
          }
        },
      });

      menu.append(menuRestore, menuPermanentDelete);
    } else {
      // Normal view: Present, Duplicate, Claim, and Delete buttons
      const menuPresent = h('button', {
        class: 'presentation-card-menu-item',
        type: 'button',
        text: t('list.present', 'Present'),
        onclick: (e) => {
          e.stopPropagation();
          menu.classList.remove('is-open');
          openPresenter(p.id);
        },
      });

      const menuDuplicate = h('button', {
        class: 'presentation-card-menu-item',
        type: 'button',
        text: t('list.duplicate', 'Duplicate'),
        onclick: async (e) => {
          e.stopPropagation();
          menu.classList.remove('is-open');
          try {
            const created = await api(`/api/presentations/${p.id}/duplicate`, {
              method: 'POST',
            });
            toast.success(t('list.duplicate.done', 'Duplicated.'), {
              id: 'list-duplicate',
              durationMs: 1800,
            });
            onDeckDuplicated?.(created);
          } catch (err) {
            toast.error(String(err?.message || err), { id: 'list-duplicate' });
          }
        },
      });

      const menuDelete = h('button', {
        class: 'presentation-card-menu-item is-danger',
        type: 'button',
        text: t('list.delete', 'Move to trash'),
        onclick: async (e) => {
          e.stopPropagation();
          menu.classList.remove('is-open');
          if (
            !(await confirmModal(h, document.body, {
              title: t('list.delete', 'Move to trash'),
              message: t('list.deleteConfirm', 'Move "{title}" to trash?', {
                title: p.title,
              }),
              confirmLabel: t('list.delete', 'Move to trash'),
              danger: true,
            }))
          )
            return;
          await api(`/api/presentations/${p.id}`, { method: 'DELETE' });
          nav?.('/app');
        },
      });
      menu.append(menuPresent, menuDuplicate);
      menu.append(menuDelete);
    }

    moreBtn.append(menu);

    // Close the menu on an outside click. The listener is attached only while
    // the menu is open (see moreBtn's onclick) and removes itself on close, so
    // a long deck list never accumulates one permanent document listener per
    // card render.
    const closeMenu = (e) => {
      if (!moreBtn.contains(e.target)) {
        menu.classList.remove('is-open');
        document.removeEventListener('click', closeMenu);
      }
    };

    // Title row with title and more button
    const titleRow = h('div', { class: 'presentation-card-title-row' }, [
      h('div', { class: 'presentation-title', text: p.title }),
      moreBtn,
    ]);

    // One-click Present affordance on the thumbnail (hover/focus reveal).
    // The card's own onclick ignores clicks that land on a <button>, so this
    // presents without also opening the editor. Not shown in trash.
    const presentBtn = !isTrashView
      ? h(
          'button',
          {
            class: 'presentation-card-present btn btn-primary',
            type: 'button',
            title: t('list.present.title', 'Start presenting'),
            onclick: (e) => {
              e.stopPropagation();
              openPresenter(p.id);
            },
          },
          [
            h('span', {
              class: 'presentation-card-present-icon',
              'aria-hidden': 'true',
              text: '▶',
            }),
            h('span', { text: t('list.present', 'Present') }),
          ]
        )
      : null;

    // Wrap thumb with checkbox overlay
    const thumbWrapper = h(
      'div',
      { class: 'presentation-card-thumb-wrapper' },
      [thumb, checkbox, presentBtn].filter(Boolean)
    );

    // Build tags element if there are tags
    const tags = Array.isArray(p.tags) ? p.tags : [];
    const tagsEl = tags.length > 0
      ? h('div', { class: 'presentation-tags' },
          tags.slice(0, 3).map((tag) =>
            h('span', {
              class: 'presentation-tag',
              text: typeof tag === 'string' ? tag : tag.name,
            })
          ).concat(
            tags.length > 3
              ? [h('span', { class: 'presentation-tag', text: `+${tags.length - 3}` })]
              : []
          )
        )
      : null;

    item.append(
      thumbWrapper,
      h('div', { class: 'stack is-gap-sm presentation-card-meta' }, [
        titleRow,
        h('div', { class: 'presentation-author-row' }, [
          avatar,
          h('div', { class: 'presentation-author-info' }, [
            h('span', { class: 'presentation-author-name', text: authorName }),
            h('span', { class: 'presentation-author-divider', text: '·' }),
            h('span', { text: when }),
          ]),
          // Visibility indicator
          getVisibilityIndicator(h, p, t),
          isOrganization
            ? h('span', {
                class: 'presentation-shared-badge',
                text: t('list.sharedBadge', 'Shared'),
              })
            : null,
          isSharedWithMe
            ? h('div', { class: 'presentation-shared-with-me-badges' }, [
                h('span', {
                  class: `presentation-permission-badge presentation-permission-badge--${permission || 'view'}`,
                  text: permission === 'edit' ? t('list.permission.edit', 'Can edit')
                      : permission === 'comment' ? t('list.permission.comment', 'Can comment')
                      : t('list.permission.view', 'Can view'),
                }),
                sharedBy
                  ? h('span', {
                      class: 'presentation-shared-by',
                      text: t('list.sharedBy', 'Shared by {name}', { name: displayNameFromEmail(sharedBy) }),
                    })
                  : null,
              ])
            : null,
        ]),
        tagsEl,
      ])
    );

    if (highlight) {
      item.classList.add('is-highlight');
      try {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          item.classList.remove('is-highlight');
        } catch {
          // ignore
        }
      }, 2200);
    }

    return item;
  };

  return { renderCard };
}

/**
 * Pick a legible text color (near-black or white) for a hex background, using
 * the WCAG relative-luminance threshold. Falls back to white on a bad input.
 * @param {string} hex - `#rgb` or `#rrggbb`
 * @returns {string}
 */
function readableTextColor(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return '#ffffff';
  // 0.4 threshold + near-black label are tuned for the list card's coloured
  // thumb backgrounds; kept distinct from the theme-wide 0.5 midpoint.
  return getRelativeLuminance(rgb) > 0.4 ? '#111827' : '#ffffff';
}

/**
 * Get the visibility indicator element for a presentation.
 * Shows different icons based on the presentation's visibility:
 * - Published (globe icon)
 * - Workspace shared (people icon)
 * - Shared with collaborators (link icon)
 * - Private (lock icon)
 */
function getVisibilityIndicator(h, p, t) {
  if (p.isPublished) {
    return h('img', {
      class: 'presentation-visibility-indicator is-published',
      title: t('list.visibility.published', 'Published'),
      src: iconUrl('globe'),
      alt: '',
      'aria-hidden': 'true',
    });
  }
  if (p.visibility === 'organization') {
    return h('img', {
      class: 'presentation-visibility-indicator is-organization',
      title: t('list.visibility.workspace', 'Shared with workspace'),
      src: iconUrl('users'),
      alt: '',
      'aria-hidden': 'true',
    });
  }
  if (p.collaboratorCount > 0) {
    return h('img', {
      class: 'presentation-visibility-indicator is-shared',
      title: t('list.visibility.shared', 'Shared with {count} people', { count: p.collaboratorCount }),
      src: iconUrl('link'),
      alt: '',
      'aria-hidden': 'true',
    });
  }
  // Private - subtle lock icon
  return h('img', {
    class: 'presentation-visibility-indicator is-private',
    title: t('list.visibility.private', 'Private'),
    src: iconUrl('lock'),
    alt: '',
    'aria-hidden': 'true',
  });
}

/**
 * Convert a full presentation document to a lightweight list item
 * @param {Object} pres - Full presentation object
 * @returns {Object} List item shape
 */
export function toListItem(pres) {
  const p = pres && typeof pres === 'object' ? pres : {};
  const slides = Array.isArray(p.slides) ? p.slides : [];
  const first = slides[0] && typeof slides[0] === 'object' ? slides[0] : null;
  const theme = typeof p.theme === 'string' && p.theme ? p.theme : 'default';
  return {
    id: p.id,
    title: p.title,
    modified: p.modified,
    created: p.created,
    theme,
    ownerEmail: p.ownerEmail || null,
    createdBy: p.createdBy || null,
    updatedBy: p.updatedBy || null,
    visibility: p.visibility || 'private',
    revision: Number(p.revision) || 1,
    i18n: p.i18n || null,
    tags: Array.isArray(p.tags) ? p.tags : [],
    hasSlides:
      !!first && typeof first.id === 'string' && typeof first.type === 'string',
  };
}