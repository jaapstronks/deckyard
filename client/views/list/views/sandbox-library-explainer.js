import { t } from '../../../lib/ui-i18n.js';
import { iconUrl } from '../../../../shared/icon-names.js';

/**
 * Sandbox stand-in for the slide library.
 *
 * A throwaway sandbox guest has no team and no reusable slides, so the real
 * library would just be empty. Instead of a blank grid, show a mockup that
 * explains what the library is for in a real Deckyard — the place where a team
 * keeps slides worth reusing (a team overview, the latest quarterly figures,
 * the standard intro/disclaimer) and groups them into collections to start new
 * decks fast. Illustrative example cards make it read as a preview, not an
 * error.
 *
 * @param {object} opts
 * @param {Function} opts.h - DOM helper
 * @returns {HTMLElement}
 */
export function createSandboxLibraryExplainer({ h }) {
  // Illustrative "what would live here" cards — purely decorative.
  const samples = [
    {
      icon: 'users',
      name: t('sandbox.library.sample.team', 'Team overview'),
      meta: t('slideLibrary.scope.team', 'Team'),
    },
    {
      icon: 'chart-bar',
      name: t('sandbox.library.sample.results', 'Latest quarterly figures'),
      meta: t('slideLibrary.scope.team', 'Team'),
    },
    {
      icon: 'presentation',
      name: t('sandbox.library.sample.intro', 'Company intro'),
      meta: t('sandbox.library.sample.collection', 'Collection'),
    },
    {
      icon: 'file-text',
      name: t('sandbox.library.sample.legal', 'Standard disclaimer'),
      meta: t('slideLibrary.scope.team', 'Team'),
    },
  ];

  const grid = h('div', { class: 'sandbox-library-grid', 'aria-hidden': 'true' });
  for (const s of samples) {
    grid.append(
      h('div', { class: 'sandbox-library-card' }, [
        h('span', { class: 'sandbox-library-card-thumb' }, [
          h('img', { class: 'sandbox-library-card-icon', src: iconUrl(s.icon), alt: '' }),
        ]),
        h('span', { class: 'sandbox-library-card-name', text: s.name }),
        h('span', { class: 'sandbox-library-card-meta', text: s.meta }),
      ])
    );
  }

  return h('div', { class: 'sandbox-library-explainer' }, [
    h('div', { class: 'sandbox-library-lead' }, [
      h('img', {
        class: 'sandbox-library-lead-icon',
        src: iconUrl('library'),
        alt: '',
        'aria-hidden': 'true',
      }),
      h('h2', {
        class: 'sandbox-library-title',
        text: t('sandbox.library.title', 'Your team’s slide library'),
      }),
      h('p', {
        class: 'sandbox-library-body',
        text: t(
          'sandbox.library.body',
          'This is where you and your teammates keep the slides worth reusing — a team overview with headshots, the latest quarterly figures, your standard intro and disclaimer — and group them into collections to start new decks in seconds.'
        ),
      }),
      h('p', {
        class: 'help sandbox-library-note',
        text: t(
          'sandbox.library.note',
          'It’s empty in the sandbox — a throwaway space has no team. In your own Deckyard, every slide you save to the library lands here.'
        ),
      }),
    ]),
    grid,
  ]);
}
