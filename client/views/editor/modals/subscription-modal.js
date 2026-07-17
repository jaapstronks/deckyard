/**
 * Per-deck notification subscription chooser (phase 4 of the comments &
 * notifications plan). Small modal from the editor more-menu: pick how
 * chatty this deck may be, or fall back to your global default.
 */

import { createModal } from '../../../lib/modal.js';
import { t } from '../../../lib/ui-i18n.js';

const LEVELS = [
  {
    value: null,
    label: () => t('subscription.level.default', 'Your default'),
    help: () => t('subscription.level.default.help', 'Follow your global notification setting.'),
  },
  {
    value: 'watching',
    label: () => t('subscription.level.watching', 'Watching'),
    help: () => t('subscription.level.watching.help', 'Every comment on this deck.'),
  },
  {
    value: 'participating',
    label: () => t('subscription.level.participating', 'Participating'),
    help: () => t('subscription.level.participating.help', 'Threads you write in, replies to you, and your own decks.'),
  },
  {
    value: 'mentions_only',
    label: () => t('subscription.level.mentionsOnly', 'Mentions only'),
    help: () => t('subscription.level.mentionsOnly.help', 'Only when someone @mentions you.'),
  },
  {
    value: 'mute',
    label: () => t('subscription.level.mute', 'Mute'),
    help: () => t('subscription.level.mute.help', 'Silence this deck. Direct @mentions still reach you.'),
  },
];

/**
 * Open the subscription chooser for a deck.
 * @param {Object} options
 * @param {Function} options.h - DOM helper
 * @param {Function} options.api - API call function
 * @param {Object} options.toast - Toast handler
 * @param {string} options.presentationId
 */
export async function openSubscriptionModal({ h, api, toast, presentationId }) {
  let current = null;
  let defaultLevel = 'participating';
  try {
    const resp = await api(`/api/presentations/${presentationId}/subscription`);
    current = resp?.level ?? null;
    defaultLevel = resp?.defaultLevel || 'participating';
  } catch {
    toast?.error?.(t('subscription.loadFailed', 'Could not load notification setting'));
    return;
  }

  const modalApi = createModal(h, {
    title: t('subscription.title', 'Notifications for this deck'),
    modalClass: 'subscription-modal',
  });

  const list = h('div', { class: 'stack subscription-level-list' });
  const buttons = [];

  const syncSelected = () => {
    for (const { btn, value } of buttons) {
      btn.classList.toggle('is-selected', value === current);
      btn.setAttribute('aria-pressed', String(value === current));
    }
  };

  for (const level of LEVELS) {
    const isDefaultRow = level.value === null;
    const defaultLabel = LEVELS.find((l) => l.value === defaultLevel)?.label() || defaultLevel;
    const btn = h('button', {
      type: 'button',
      class: 'subscription-level-option',
      onclick: async () => {
        try {
          await api(`/api/presentations/${presentationId}/subscription`, {
            method: 'PUT',
            body: JSON.stringify({ level: level.value }),
          });
          current = level.value;
          syncSelected();
          toast?.success?.(t('subscription.saved', 'Notification setting saved'));
          modalApi.close();
        } catch {
          toast?.error?.(t('subscription.saveFailed', 'Could not save notification setting'));
        }
      },
    }, [
      h('span', {
        class: 'subscription-level-label',
        text: isDefaultRow ? `${level.label()} (${defaultLabel})` : level.label(),
      }),
      h('span', { class: 'subscription-level-help', text: level.help() }),
    ]);
    buttons.push({ btn, value: level.value });
    list.append(btn);
  }
  syncSelected();

  modalApi.content.append(
    h('div', {
      class: 'help',
      text: t(
        'subscription.hint',
        'Controls which comment activity on this deck notifies you (bell and email). Direct @mentions always come through.'
      ),
    }),
    list
  );
  modalApi.show(document.body);
}
