import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';

const SKELETON_CLASS = 'editor-loading-skeleton';

/**
 * Show a full-page editor loading skeleton inside `root`.
 *
 * Reuses the real editor layout classes (`.editor-shell`, `.layout`,
 * `.panel.slides-panel` / `.preview-panel` / `.inspector-panel`) so the column
 * split and every responsive breakpoint match what the editor will render,
 * and the swap to real content doesn't shift anything.
 *
 * Idempotent: if a skeleton is already mounted in `root` (e.g. shown early
 * by the app router), the existing one is reused.
 *
 * @param {HTMLElement} root
 * @returns {() => void} remove function
 */
export function showEditorLoadingSkeleton(root) {
  if (!root) return () => {};

  const existing = root.querySelector(`.${SKELETON_CLASS}`);
  if (existing) return () => existing.remove();

  const block = (cls) => h('div', { class: `skeleton-block ${cls}` });

  const topbar = h('div', { class: 'topbar skeleton-topbar' }, [
    block('skeleton-topbar-btn'),
    block('skeleton-topbar-title'),
    h('div', { class: 'skeleton-topbar-actions' }, [
      block('skeleton-topbar-chip'),
      block('skeleton-topbar-chip'),
      block('skeleton-topbar-btn'),
    ]),
  ]);

  const slideRows = [];
  for (let i = 0; i < 8; i++) {
    slideRows.push(
      h('div', { class: 'skeleton-slide-row' }, [
        block('skeleton-slide-num'),
        block('skeleton-slide-thumb'),
      ])
    );
  }
  const left = h('div', { class: 'panel slides-panel' }, [
    h('div', { class: 'slides-panel-header' }, [block('skeleton-heading')]),
    h('div', { class: 'panel-scroll skeleton-scroll' }, slideRows),
  ]);

  const fields = [];
  for (let i = 0; i < 5; i++) {
    fields.push(
      h('div', { class: 'skeleton-field' }, [
        block('skeleton-label'),
        block('skeleton-input'),
      ])
    );
  }
  const inspector = h('div', { class: 'panel inspector-panel' }, [
    h('div', { class: 'panel-scroll skeleton-scroll' }, [
      block('skeleton-heading'),
      ...fields,
    ]),
  ]);

  const status = h('div', { class: 'skeleton-status', role: 'status' }, [
    h('span', { class: 'skeleton-spinner', 'aria-hidden': 'true' }),
    h('span', {
      class: 'skeleton-status-text',
      text: t('editor.loading.deck', 'Loading presentation…'),
    }),
  ]);
  const preview = h('div', { class: 'panel preview-panel' }, [
    h('div', { class: 'preview-panel-header skeleton-preview-header' }, [
      block('skeleton-heading'),
    ]),
    h('div', { class: 'panel-scroll preview-panel-scroll' }, [
      h('div', { class: 'skeleton-canvas' }, [status]),
    ]),
  ]);

  const shell = h(
    'div',
    { class: `app-shell editor-shell ${SKELETON_CLASS}` },
    [topbar, h('div', { class: 'layout' }, [left, preview, inspector])]
  );
  root.append(shell);
  return () => shell.remove();
}

/**
 * Remove any mounted editor loading skeleton from `root` (no-op if absent).
 * @param {HTMLElement} root
 */
export function hideEditorLoadingSkeleton(root) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll(`.${SKELETON_CLASS}`)) el.remove();
}
