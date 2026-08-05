import { h } from '../../lib/dom.js';
import { createUiModeSwitcher } from '../ui-mode-switcher.js';

/**
 * Build the follow-along (audience) DOM scaffold: topbar (title, language
 * buttons slot, UI-mode switcher, status), the slide/interaction stage, and the
 * collapsible Q&A panel with its input.
 *
 * Copy is read through `getCopy` (not captured by value) so that after an
 * in-session language switch the collapse toggle still renders the correct
 * expand/collapse label — matching the original mutable-closure behaviour.
 *
 * @param {object} opts
 * @param {() => object} opts.getCopy - live localized copy bundle.
 * @returns {{
 *   shell: HTMLElement, topbar: HTMLElement, title: HTMLElement,
 *   langWrap: HTMLElement, eraseSlot: HTMLElement, status: HTMLElement,
 *   uiMode: { el: HTMLElement, detach?: () => void },
 *   stageWrap: HTMLElement, slideWrap: HTMLElement, interactionWrap: HTMLElement,
 *   qaWrap: HTMLElement, qaTitle: HTMLElement, qaHint: HTMLElement,
 *   qaNameBtn: HTMLElement, qaInput: HTMLTextAreaElement, qaAskBtn: HTMLElement,
 *   qaList: HTMLElement,
 * }}
 */
export function buildFollowLayout({ getCopy }) {
  const copy = getCopy();

  const shell = h('div', { class: 'follow-shell' });
  const topbar = h('div', { class: 'follow-topbar' });
  const title = h('div', {
    class: 'follow-title',
    text: copy.title,
  });
  const langWrap = h('div', { class: 'follow-lang' });
  const actions = h('div', { class: 'follow-actions' });
  // Slot for the "forget me" button. The tracker is created asynchronously
  // (only for anonymous viewers, after an auth check), so the button is filled
  // in later — this keeps a stable place for it in the topbar.
  const eraseSlot = h('div', { class: 'follow-erase-slot' });
  const uiMode = createUiModeSwitcher({ h, className: 'follow-ui-mode' });
  const status = h('div', {
    class: 'follow-status',
    text: copy.connecting,
  });
  actions.append(langWrap, eraseSlot, uiMode.el);
  topbar.append(title, actions, status);

  const stageWrap = h('div', {
    class: 'follow-stage',
  });
  const slideWrap = h('div', { class: 'follow-slide thumb' });
  const interactionWrap = h('div', {
    class: 'follow-interaction',
    style: 'display:none;',
  });
  stageWrap.append(slideWrap, interactionWrap);

  const qaWrap = h('div', { class: 'follow-qa' });
  const qaHeader = h('div', {
    class: 'row spread',
  });
  const qaTitle = h('div', {
    class: 'follow-qa-title',
    text: copy.qaTitle,
  });
  const qaActionsTop = h('div', {
    class: 'row',
  });
  const qaHint = h('div', { class: 'help', text: '' });
  const qaNameBtn = h('button', {
    class: 'btn btn-secondary follow-qa-name-btn',
    text: '',
  });
  // Collapsible Q&A: on a landscape phone the question strip eats the vertical
  // space the slide wants, so let the audience fold it away. State is remembered
  // per device so a folded strip stays folded across slide changes and reloads.
  const QA_COLLAPSE_KEY = 'deckyard:follow:qaCollapsed';
  const qaCollapseBtn = h('button', {
    class: 'btn btn-secondary follow-qa-collapse-btn',
    type: 'button',
    'aria-controls': 'follow-qa-collapsible',
  });
  let qaCollapsed = false;
  try {
    qaCollapsed = localStorage.getItem(QA_COLLAPSE_KEY) === '1';
  } catch {
    // localStorage may be unavailable (private mode); default to expanded.
  }
  const applyQaCollapsed = () => {
    const c = getCopy();
    qaWrap.classList.toggle('is-collapsed', qaCollapsed);
    qaCollapseBtn.setAttribute('aria-expanded', String(!qaCollapsed));
    qaCollapseBtn.textContent = qaCollapsed ? c.qaExpand : c.qaCollapse;
  };
  qaCollapseBtn.addEventListener('click', () => {
    qaCollapsed = !qaCollapsed;
    try {
      localStorage.setItem(QA_COLLAPSE_KEY, qaCollapsed ? '1' : '0');
    } catch {
      // ignore persistence failures; the in-memory toggle still works.
    }
    applyQaCollapsed();
  });
  qaActionsTop.append(qaNameBtn, qaHint, qaCollapseBtn);
  qaHeader.append(qaTitle, qaActionsTop);

  const qaInput = h('textarea', {
    class: 'form-input follow-qa-input',
    placeholder: copy.qaPlaceholder,
  });
  qaInput.addEventListener('keydown', (ev) => {
    // Submit on Enter (mobile-friendly). Keep Shift+Enter as a newline escape hatch.
    if (ev.key !== 'Enter') return;
    if (ev.shiftKey) return;
    // Avoid interfering with IME composition.
    if (ev.isComposing) return;
    ev.preventDefault();
    try {
      qaAskBtn.click();
    } catch {
      // ignore
    }
  });
  const qaAskBtn = h('button', {
    class: 'btn btn-primary',
    text: copy.qaAsk,
  });
  const qaForm = h('div', { class: 'follow-qa-form' }, [
    qaInput,
    qaAskBtn,
  ]);
  const qaList = h('div', { class: 'follow-qa-list', id: 'follow-qa-collapsible' });
  // Put questions ABOVE the input (so your own question shows above the box after posting).
  qaWrap.append(qaHeader, qaList, qaForm);
  applyQaCollapsed();

  shell.append(topbar, stageWrap, qaWrap);

  return {
    shell,
    topbar,
    title,
    langWrap,
    eraseSlot,
    status,
    uiMode,
    stageWrap,
    slideWrap,
    interactionWrap,
    qaWrap,
    qaTitle,
    qaHint,
    qaNameBtn,
    qaInput,
    qaAskBtn,
    qaList,
  };
}
