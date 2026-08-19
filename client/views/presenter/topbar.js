import { h } from '../../lib/dom.js';
import { api } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';
import { createPresenterControlToggle } from './control-toggle.js';

/**
 * Assemble the presenter topbar: the deck title and the actions row (notes
 * companion + remote control, tools, laser/draw, console toggle, second-screen,
 * edit, fullscreen, auto-advance, help).
 *
 * Interactive controls are created by the orchestrator (their handlers close
 * over live presenter state) and passed in as elements; this module only owns
 * the composition plus the inline stateless buttons and the control toggle.
 *
 * @param {object} opts
 * @param {object} opts.pres - presentation (for the title).
 * @param {HTMLElement} opts.langSeg
 * @param {HTMLElement} opts.translatePill
 * @param {HTMLElement} opts.interactionPill
 * @param {HTMLElement} opts.toolsWrap
 * @param {HTMLElement} opts.autoAdvanceBtn
 * @param {HTMLElement} opts.laserBtn
 * @param {HTMLElement} opts.drawBtn
 * @param {HTMLElement} opts.consoleToggle
 * @param {() => (string|null)} opts.getSessionId - for the control toggle.
 * @param {() => void} opts.onOpenProjector
 * @param {() => void} opts.onEdit
 * @param {() => void} opts.onToggleFullscreen
 * @returns {{ top: HTMLElement }}
 */
export function buildPresenterTopbar({
  pres,
  langSeg,
  translatePill,
  interactionPill,
  toolsWrap,
  autoAdvanceBtn,
  laserBtn,
  drawBtn,
  consoleToggle,
  getSessionId,
  onOpenProjector,
  onEdit,
  onToggleFullscreen,
}) {
  const top = h('div', { class: 'presenter-topbar' });
  const actions = h('div', { class: 'presenter-actions' });

  actions.append(
    // Notes companion + remote control
    langSeg,
    translatePill,
    interactionPill,
    toolsWrap,
    createPresenterControlToggle({ h, api, getSessionId }).el,
    laserBtn,
    drawBtn,
    consoleToggle,
    h('button', {
      class: 'btn btn-secondary',
      text: t('presenter.projector.open', 'Second screen'),
      title: t(
        'presenter.projector.openTitle',
        'Open the clean deck in a second window for the projector, and keep the console on this screen',
      ),
      onclick: () => onOpenProjector(),
    }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('presenter.edit', 'Edit'),
      onclick: () => onEdit(),
    }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('presenter.fullscreen', 'Fullscreen'),
      onclick: () => onToggleFullscreen(),
    }),
    autoAdvanceBtn,
    h('div', {
      class: 'presenter-help',
      text: t('presenter.help', '←/→ move · F fullscreen · ? shortcuts'),
    }),
  );

  top.append(
    h('div', {
      class: 'presenter-title',
      text: pres.title,
    }),
    actions,
  );

  return { top };
}
