import { h } from '../../lib/dom.js';
import { attachThumbScale } from '../../lib/thumb-scale.js';
import { renderSlideElement } from '../../lib/slide-render.js';
import { loadThemeById } from '../../lib/theme.js';
import { toast } from '../../lib/toast.js';
import { confirmModal } from '../../lib/modal.js';
import { displayNameFromEmail } from '../../lib/user-format.js';
import { formatRelativeTime } from '../../lib/format-time.js';
import { t } from '../../lib/ui-i18n.js';
import { createAvatar } from '../../lib/avatar.js';
import { getUserProfile } from '../../lib/user-profiles.js';
import { iconUrl } from '../../../shared/icon-names.js';

/**
 * Creates a presentation card renderer with shared context
 * @param {Object} ctx - Context with dependencies and callbacks
 * @returns {Object} Card renderer utilities
 */
export function createCardRenderer({
  api,
  nav,
  onDeckDuplicated,
  onDeckClaimed,
  onTrashRefresh,
  detachThumbs,
  aborters,
  selectionState = null,
}) {
  const authorEmailForPresentation = (p) =>
    String(p?.updatedBy || p?.createdBy || p?.ownerEmail || '').trim();

  const openPresentation = (id) => nav?.(`/app/${id}`);
  const openPresenter = (id) => nav?.(`/present/${id}`);

  /**
   * Render a presentation card
   * @param {Object} p - Presentation data
   * @param {Object} options - Render options
   * @param {boolean} [options.isWorkspace] - Is this a workspace presentation
   * @param {boolean} [options.highlight] - Highlight the card
   * @param {boolean} [options.isSharedWithMe] - Is this from "Shared with me"
   * @param {boolean} [options.isStarterKit] - Is this a starter kit
   * @param {boolean} [options.isTrashView] - Is this in the trash view
   * @param {string} [options.sharedBy] - Email of the person who shared it
   * @param {string} [options.permission] - Permission level (view, comment, edit)
   * @returns {HTMLElement} Card element
   */
  const renderCard = (p, { isWorkspace, highlight = false, isSharedWithMe = false, isStarterKit = false, isTrashView = false, sharedBy, permission } = {}) => {
    // Check if this presentation is a starter kit (from data or options)
    const showStarterKitBadge = isStarterKit || p?.isStarterKit;

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

    const thumb = h('div', { class: 'thumb' });
    detachThumbs.push(attachThumbScale(thumb, { virtualWidth: 1600 }));

    const showThumbSlide = async (slide, themeId) => {
      thumb.innerHTML = '';
      if (!slide) {
        thumb.append(
          h('div', {
            class: 'help thumb-overlay is-muted',
            text: t('list.thumb.empty', 'No slides yet'),
          })
        );
        return;
      }
      try {
        const theme = await loadThemeById(themeId);
        thumb.append(renderSlideElement(slide, { mode: 'thumb', theme, presentationId: p.id }));
      } catch {
        // ignore thumbnail rendering errors; keep the list usable
      }
    };

    // Prefer server-provided firstSlide for speed, but fall back to fetching
    // the presentation so thumbnails always work (and reflect edits).
    if (p.firstSlide) {
      showThumbSlide(p.firstSlide, p.theme);
    } else {
      showThumbSlide(null, p.theme);
      thumb.append(
        h('div', {
          class: 'help thumb-overlay is-bottom',
          text: t('list.thumb.loading', 'Loading preview…'),
        })
      );
      const ac = new AbortController();
      aborters.push(ac);
      api(`/api/presentations/${p.id}`, { signal: ac.signal })
        .then((full) => {
          const first = full?.slides?.[0] || null;
          showThumbSlide(first, full?.theme);
        })
        .catch(() => {
          // ignore
        });
    }

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
        menu.classList.toggle('is-open');
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

      // Check if this is a legacy presentation (no owner, no creator) that can be claimed
      const isLegacy = !p.ownerEmail && !p.createdBy;
      const menuClaim = isLegacy
        ? h('button', {
            class: 'presentation-card-menu-item',
            type: 'button',
            text: t('list.claim', 'Claim as mine'),
            onclick: async (e) => {
              e.stopPropagation();
              menu.classList.remove('is-open');
              try {
                const claimed = await api(`/api/presentations/${p.id}`, {
                  method: 'PATCH',
                  body: { action: 'claim', scope: 'private' },
                });
                toast.success(t('list.claim.done', 'Claimed as yours.'), {
                  id: 'list-claim',
                  durationMs: 1800,
                });
                onDeckClaimed?.(claimed);
              } catch (err) {
                toast.error(String(err?.message || err), { id: 'list-claim' });
              }
            },
          })
        : null;

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
      if (menuClaim) menu.append(menuClaim);
      menu.append(menuDelete);
    }

    moreBtn.append(menu);

    // Close menu when clicking outside
    const closeMenu = (e) => {
      if (!moreBtn.contains(e.target)) {
        menu.classList.remove('is-open');
      }
    };
    document.addEventListener('click', closeMenu);

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
          showStarterKitBadge
            ? h('span', {
                class: 'presentation-starter-kit-badge',
                text: t('list.starterKitBadge', 'Template'),
              })
            : isWorkspace
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
  if (p.scope === 'workspace') {
    return h('img', {
      class: 'presentation-visibility-indicator is-workspace',
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
    scope: p.scope || 'private',
    isStarterKit: !!p.isStarterKit,
    revision: Number(p.revision) || 1,
    i18n: p.i18n || null,
    tags: Array.isArray(p.tags) ? p.tags : [],
    firstSlide:
      first && typeof first.id === 'string' && typeof first.type === 'string'
        ? { id: first.id, type: first.type, content: first.content || {} }
        : null,
  };
}