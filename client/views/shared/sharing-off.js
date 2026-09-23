import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * The one sentence every sharing entry shows where sharing is off (D181,
 * `sharingEnabled()` in `client/lib/state/features.js`). The entry itself
 * stays on screen, greyed out, so a sandbox visitor sees the capability exists
 * and why it does nothing here — the sandbox rule "greyed out with a reason
 * beats hidden".
 *
 * @returns {HTMLElement}
 */
export function createSharingOffNote() {
  return h('div', {
    class: 'help sharing-off-note',
    text: t(
      'sandbox.sharing.off',
      'In the sandbox you work on your own. In your own Deckyard you share decks and slides with your team.',
    ),
  });
}

/**
 * Grey out a whole group of sharing controls. A disabled `<fieldset>` rather
 * than a pass over the controls, because the sections inside re-render (a
 * collaborator list that loads, a radio that re-draws) and a control built
 * after the pass would come back live; the fieldset disables every descendant
 * control whenever it is built.
 *
 * @param {Array<HTMLElement>} children
 * @returns {HTMLFieldSetElement}
 */
export function createSharingOffFieldset(children) {
  return h(
    'fieldset',
    { class: 'sharing-off-controls', disabled: true, 'aria-disabled': 'true' },
    children,
  );
}
