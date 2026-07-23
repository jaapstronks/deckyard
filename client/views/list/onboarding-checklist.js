import { t } from '../../lib/ui-i18n.js';
import { storage } from '../../lib/storage.js';
import { getFeatures } from '../../lib/state/features.js';

/**
 * First-run onboarding checklist for the Home view.
 *
 * A small, dismissible card that gives a brand-new user a short list of next
 * steps (create a deck / connect an AI agent). It only activates for genuinely
 * new users — someone who lands on Home with zero decks — so existing users
 * never get nagged. Progress + dismissal persist in localStorage, so the card
 * survives the jump from the empty Home to the populated Home (where the
 * "create a deck" step reads as done) and disappears once every step is done or
 * the user dismisses it.
 *
 * @module onboarding-checklist
 */

const STORAGE_KEY = 'deckyard.onboarding.v1';

/**
 * @typedef {object} OnboardingState
 * @property {boolean} started - Onboarding activated (new user). Sticky once set.
 * @property {boolean} dismissed - User closed the card.
 * @property {boolean} mcp - "Connect an AI agent" step done.
 */

/** @returns {OnboardingState|null} */
function readState() {
  return storage.getJSON(STORAGE_KEY, null);
}

/** @param {OnboardingState} state */
function writeState(state) {
  storage.setJSON(STORAGE_KEY, state);
}

/**
 * Build the onboarding checklist card, or return `null` when it shouldn't show
 * (existing user, dismissed, or every step already done).
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @param {Function} opts.nav - Navigation function
 * @param {Array} opts.allByDate - All presentations (used to derive "has a deck")
 * @param {Function} opts.onCreate - Open the new-presentation modal
 * @param {Function} [opts.api] - API client, used to auto-detect a connected
 *   AI agent (an API key that has actually been used).
 * @returns {HTMLElement|null}
 */
export function createOnboardingChecklist({
  h,
  nav,
  allByDate,
  onCreate,
  api,
}) {
  const hasDeck = Array.isArray(allByDate) && allByDate.length > 0;
  const isSandbox = !!getFeatures()?.sandboxMode;

  let state = readState();
  if (!state) {
    // First ever load. Activate onboarding only for genuinely new users (no
    // decks yet); a user who already has decks and no stored state is an
    // existing user and should never see the checklist.
    state = { started: !hasDeck, dismissed: false, mcp: false };
    writeState(state);
  }

  const stepDone = {
    create: () => hasDeck,
    mcp: () => !!state.mcp,
  };

  const steps = [
    {
      key: 'create',
      title: t('list.onboarding.createTitle', 'Create your first deck'),
      hint: t('list.onboarding.createHint', 'Start blank, from your notes, or from a template.'),
      onAction: () => onCreate?.(),
    },
    // Agent-native is a headline Deckyard feature, but a sandbox guest can't
    // create the API key it needs (anonymous, throwaway). So instead of a CTA
    // that dead-ends on a settings page they can't use, show it as a greyed-out
    // "here's what this does in a real Deckyard" note.
    isSandbox
      ? {
          key: 'mcp',
          info: true,
          title: t('list.onboarding.mcpTitle', 'Connect an AI agent'),
          hint: t(
            'list.onboarding.mcpSandboxHint',
            'Off in the sandbox. In your own Deckyard, drive decks from Claude and other agents via API or MCP.'
          ),
        }
      : {
          key: 'mcp',
          title: t('list.onboarding.mcpTitle', 'Connect an AI agent'),
          hint: t('list.onboarding.mcpHint', 'Drive Deckyard from Claude and other agents via API or MCP.'),
          onAction: () => {
            markStepDone('mcp');
            nav?.('/settings#api-keys');
          },
        },
  ].filter(Boolean);

  // Info rows (e.g. the sandbox agent note) aren't completable, so they never
  // count toward progress or block the "all done" auto-dismiss.
  const actionableSteps = steps.filter((s) => !s.info);
  const allDone = () => actionableSteps.every((s) => stepDone[s.key]());

  if (!state.started || state.dismissed || allDone()) return null;

  const rows = new Map();

  const progressLabel = h('span', { class: 'onboarding-checklist-progress' });

  const dismissBtn = h('button', {
    class: 'onboarding-checklist-dismiss',
    type: 'button',
    'aria-label': t('list.onboarding.dismiss', 'Dismiss checklist'),
    text: '×',
    onclick: () => {
      state.dismissed = true;
      writeState(state);
      card.remove();
    },
  });

  const header = h('div', { class: 'onboarding-checklist-header' }, [
    h('div', { class: 'onboarding-checklist-heading' }, [
      h('span', { class: 'onboarding-checklist-title', text: t('list.onboarding.title', 'Get started') }),
      progressLabel,
    ]),
    dismissBtn,
  ]);

  const list = h('ul', { class: 'onboarding-checklist-steps' });

  for (const step of steps) {
    const stepText = h('span', { class: 'onboarding-checklist-step-text' }, [
      h('span', { class: 'onboarding-checklist-step-title', text: step.title }),
      h('span', { class: 'onboarding-checklist-step-hint help', text: step.hint }),
    ]);

    let row;
    if (step.info) {
      // Non-interactive explainer row: a lock glyph, no click, greyed out.
      const status = h('span', {
        class: 'onboarding-checklist-status is-locked',
        'aria-hidden': 'true',
        text: '🔒',
      });
      row = h('li', { class: 'onboarding-checklist-step is-info' }, [
        h('div', { class: 'onboarding-checklist-step-btn' }, [status, stepText]),
      ]);
    } else {
      const status = h('span', { class: 'onboarding-checklist-status', 'aria-hidden': 'true' });
      row = h('li', { class: 'onboarding-checklist-step' }, [
        h('button', {
          class: 'onboarding-checklist-step-btn',
          type: 'button',
          onclick: () => step.onAction(),
        }, [
          status,
          stepText,
        ]),
      ]);
    }
    rows.set(step.key, row);
    list.append(row);
  }

  const card = h('section', {
    class: 'onboarding-checklist',
    'data-onboarding': 'checklist',
    'aria-label': t('list.onboarding.title', 'Get started'),
  }, [header, list]);

  function refreshStep(key) {
    const row = rows.get(key);
    if (row && stepDone[key]) row.classList.toggle('is-done', stepDone[key]());
  }

  function refreshProgress() {
    const done = actionableSteps.filter((s) => stepDone[s.key]()).length;
    progressLabel.textContent = t('list.onboarding.progress', '{done} of {total} done')
      .replace('{done}', String(done))
      .replace('{total}', String(actionableSteps.length));
  }

  function markStepDone(key) {
    if (state[key]) return;
    state[key] = true;
    writeState(state);
    refreshStep(key);
    refreshProgress();
    if (allDone()) card.remove();
  }

  for (const step of steps) refreshStep(step.key);
  refreshProgress();

  // Auto-complete the "Connect an AI agent" step: MCP and the REST API both
  // require an API key, and validating one stamps `lastUsedAt`. So a key that
  // has ever been used is proof an agent actually connected — tick the step
  // without the user having to click it. Best-effort: any failure just leaves
  // the manual click-to-complete path intact.
  if (!state.mcp && !isSandbox && typeof api === 'function') {
    (async () => {
      try {
        const resp = await api('/api/api-keys');
        const keys = Array.isArray(resp?.keys) ? resp.keys : [];
        if (keys.some((k) => k?.lastUsedAt)) markStepDone('mcp');
      } catch {
        // No API-keys endpoint (or not reachable): keep the manual path.
      }
    })();
  }

  return card;
}
