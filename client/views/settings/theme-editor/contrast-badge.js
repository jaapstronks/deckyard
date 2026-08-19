/**
 * Contrast Badge Component
 *
 * Reports a text-on-background pair's readability next to the pickers that
 * produce it, so a failing combination is visible while you are choosing it
 * rather than after you have saved it.
 *
 * Deliberately never blocks: a self-hoster may have a brand reason to ship a
 * low-contrast variant, and this panel is not the place to overrule that. The
 * badge states the measurement and gets out of the way.
 *
 * Two readings per pair — the WCAG 2.2 verdict, which is what accessibility
 * obligations actually reference, and the APCA Lc as a perceptual second
 * opinion. See `shared/contrast.js` for why both.
 */

import { h } from '../../../lib/dom.js';
import { t } from '../../../lib/ui-i18n.js';
import { assessContrast } from '../../../../shared/contrast.js';

/**
 * Human label for a size-aware WCAG verdict.
 * @param {'fail'|'aa'|'aaa'} level
 * @param {'body'|'large'} size
 * @returns {string}
 */
function levelLabel(level, size) {
  if (level === 'aaa') return t('settings.themes.contrast.aaa', 'AAA');
  if (level === 'fail') return t('settings.themes.contrast.fail', 'Fails');
  return size === 'large'
    ? t('settings.themes.contrast.aaLarge', 'AA large')
    : t('settings.themes.contrast.aa', 'AA');
}

/**
 * Create a contrast badge for one text-on-background pair.
 *
 * Argument order on `update` follows APCA's requirement (text first), which the
 * WCAG ratio is indifferent to.
 * @param {Object} [options]
 * @param {'body'|'large'} [options.size] - Which threshold set applies. Slide
 *   titles, table headers and button labels are `large`; body copy is `body`.
 * @param {string} [options.label] - Optional leading label naming the pair.
 * @returns {{el: HTMLElement, update: (textHex: string, bgHex: string) => void}}
 */
export function createContrastBadge({ size = 'body', label = '' } = {}) {
  const sample = h('span', {
    class: 'theme-contrast-sample',
    text: t('settings.themes.contrast.sample', 'Aa'),
    'aria-hidden': 'true',
  });

  const ratioEl = h('span', { class: 'theme-contrast-ratio' });
  const levelEl = h('span', { class: 'theme-contrast-level' });
  const apcaEl = h('span', { class: 'theme-contrast-apca' });

  const readout = h('span', { class: 'theme-contrast-readout' }, [
    ratioEl,
    levelEl,
    apcaEl,
  ]);

  const children = [sample, readout];
  if (label) {
    children.unshift(
      h('span', { class: 'theme-contrast-pair-label', text: label }),
    );
  }

  // Announce politely: the numbers change on every drag of the colour picker,
  // and an assertive region would talk over the user continuously.
  const el = h(
    'div',
    { class: 'theme-contrast-badge', role: 'status', 'aria-live': 'polite' },
    children,
  );

  /**
   * Re-measure and repaint.
   * @param {string} textHex
   * @param {string} bgHex
   */
  function update(textHex, bgHex) {
    const result = assessContrast(textHex, bgHex, { size });

    sample.style.background = bgHex;
    sample.style.color = textHex;

    ratioEl.textContent = t('settings.themes.contrast.ratio', '{ratio}:1', {
      ratio: result.ratio.toFixed(2),
    });
    levelEl.textContent = levelLabel(result.level, result.size);
    levelEl.dataset.level = result.level;

    const lc = Math.round(Math.abs(result.apcaLc));
    apcaEl.textContent = t('settings.themes.contrast.apca', 'Lc {lc}', { lc });
    apcaEl.dataset.apca = result.apcaPasses ? 'pass' : 'fail';
    apcaEl.title = result.disagree
      ? t(
          'settings.themes.contrast.disagreeHint',
          'APCA and WCAG disagree here. WCAG is the standard to meet; APCA models perceived contrast better, especially for light text on dark backgrounds.',
        )
      : t(
          'settings.themes.contrast.apcaHint',
          'APCA perceptual contrast (candidate method for WCAG 3), shown alongside the WCAG verdict.',
        );

    el.dataset.level = result.level;
  }

  return { el, update };
}
