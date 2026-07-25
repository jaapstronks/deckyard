import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { createUiModeSwitcher } from '../ui-mode-switcher.js';

/**
 * Build the speaker-notes companion DOM scaffold.
 *
 * Pure construction: creates the shell and every element the orchestrator wires
 * up, with no state or event handlers attached. Returns the shell plus named
 * references to the interactive nodes.
 *
 * @returns {{
 *   shell: HTMLElement, topbar: HTMLElement, title: HTMLElement,
 *   uiMode: { el: HTMLElement, detach?: () => void }, refollowBtn: HTMLElement,
 *   presenterHint: HTMLElement, previewControls: HTMLElement,
 *   previewPrevBtn: HTMLElement, previewNextBtn: HTMLElement, previewMeta: HTMLElement,
 *   previewWrap: HTMLElement, nextLabel: HTMLElement, nextPreviewWrap: HTMLElement,
 *   notesWrap: HTMLElement, notesTitle: HTMLElement, notesBody: HTMLElement,
 *   qaWrap: HTMLElement, qaBody: HTMLElement,
 * }}
 */
export function buildNotesLayout() {
  const shell = h('div', { class: 'notes-shell' });
  const topbar = h('div', { class: 'notes-topbar' });
  const title = h('div', {
    class: 'notes-title',
    text: t('notes.speakerNotes', 'Speaker notes'),
  });
  const uiMode = createUiModeSwitcher({ h, className: 'notes-ui-mode' });
  const refollowBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notes.refollow', 'Re-follow'),
    hidden: true,
  });
  topbar.append(
    h('div', { class: 'row' }, [
      title,
    ]),
    h('div', { class: 'row' }, [
      uiMode.el,
      refollowBtn,
    ])
  );

  const presenterHint = h('div', {
    class: 'notes-hint',
    hidden: true,
  });

  const previewControls = h('div', {
    class: 'notes-preview-controls',
  });
  const previewPrevBtn = h('button', {
    class: 'btn btn-secondary notes-preview-prev',
    text: t('notes.previewPrev', '◀︎ Preview'),
    title: t('notes.prevSlide.title', 'Previous slide (local only)'),
  });
  const previewNextBtn = h('button', {
    class: 'btn btn-secondary notes-preview-next',
    text: t('notes.previewNext', 'Preview ▶︎'),
    title: t('notes.nextSlide.title', 'Next slide (local only)'),
  });
  const previewMeta = h('div', {
    class: 'help notes-preview-meta',
    text: '',
  });
  previewControls.append(
    previewPrevBtn,
    previewMeta,
    previewNextBtn
  );

  const previewWrap = h('div', {
    class: 'notes-preview thumb',
  });

  // "Up next" preview: the slide after the current view. Lets the presenter
  // see what's coming without peeking ahead (which detaches from the live deck).
  const nextLabel = h('div', {
    class: 'help notes-next-label',
    text: t('notes.upNext', 'Up next'),
  });
  const nextPreviewWrap = h('div', {
    class: 'notes-next-preview thumb',
  });
  const nextPreview = h('div', { class: 'notes-next' }, [
    nextLabel,
    nextPreviewWrap,
  ]);

  const notesWrap = h('div', { class: 'notes-panel' });
  const notesTitle = h('div', {
    class: 'notes-panel-title',
    text: t('notes.notes', 'Notes'),
  });
  const notesBody = h('div', {
    class: 'notes-body',
  });
  notesWrap.append(notesTitle, notesBody);

  const qaWrap = h('div', { class: 'notes-panel notes-qa-panel' });
  const qaTitle = h('div', { class: 'notes-panel-title', text: t('notes.qa', 'Q&A') });
  const qaBody = h('div', { class: 'stack' });
  qaWrap.append(qaTitle, qaBody);

  shell.append(
    topbar,
    presenterHint,
    previewControls,
    previewWrap,
    nextPreview,
    notesWrap,
    qaWrap
  );

  return {
    shell,
    topbar,
    title,
    uiMode,
    refollowBtn,
    presenterHint,
    previewControls,
    previewPrevBtn,
    previewNextBtn,
    previewMeta,
    previewWrap,
    nextLabel,
    nextPreviewWrap,
    notesWrap,
    notesTitle,
    notesBody,
    qaWrap,
    qaBody,
  };
}
