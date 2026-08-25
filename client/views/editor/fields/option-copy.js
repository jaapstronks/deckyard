/**
 * The translated copy of one enum option — the single reader of the option
 * i18n keys the registry stamps (shared/ui-i18n-keys.js).
 *
 * Before B145 no reader existed for the top-level enum control: the segmented
 * buttons and the select rendered `opt.label` raw, so a locale saw English no
 * matter what, and the keys the registry minted were translated into eleven
 * languages that nothing ever asked for. One resolver, used by every enum
 * surface, is what makes minting a key mean something.
 *
 * `title`/`ariaLabel` fall back to the translated LABEL rather than the raw
 * one: a registry option only carries its own title/aria key when it says
 * something the label does not, so without one the tooltip is the label —
 * translated. The exception is an option composed at runtime rather than by
 * the registry (the `image-fit` widget builds its own already-translated
 * list): it has no keys at all, so a title or aria it declares itself is copy
 * that would otherwise be dropped.
 */
import { t } from '../../../lib/ui-i18n.js';
import { normalizeOption } from '../../../../shared/ui-i18n-keys.js';

/**
 * @param {string|Object} raw - an option as the registry composed it
 * @returns {{value: string, label: string, title: string, ariaLabel: string}}
 */
export function optionCopy(raw) {
  const opt = normalizeOption(raw);
  const label = opt.labelKey ? t(opt.labelKey, opt.label) : opt.label;
  const own = (slot) => (opt[slot] && opt[slot] !== opt.label ? opt[slot] : '');
  const title = opt.titleKey
    ? t(opt.titleKey, opt.title)
    : own('title') || label;
  const ariaLabel = opt.ariaLabelKey
    ? t(opt.ariaLabelKey, opt.ariaLabel)
    : own('ariaLabel') || label;
  return { ...opt, label, title, ariaLabel };
}
