/** Organization translation reference, edited only by organization admins. */
import { h } from '../../../lib/dom/index.js';
import { createInlineError } from '../../../lib/dom/inline-error.js';
import { toast } from '../../../lib/dom/toast.js';
import { t } from '../../../lib/ui-i18n.js';
import {
  fetchAppSettings,
  fetchOrgSettings,
  updateOrgSettings,
} from '../../../lib/net/settings.js';
import { getLangDisplayName } from '../../../../shared/i18n-utils.js';
import { TRANSLATION_INSTRUCTION_MAX_LENGTH } from '../../../../shared/constants/translation-instructions.js';

/** @returns {{el: HTMLElement, load: () => Promise<void>}} */
export function createTranslationInstructionsCard() {
  const card = h('section', { class: 'stack editor-card' });
  const heading = h('h3', {
    class: 'field-label',
    text: t(
      'settings.admin.translationInstructions.title',
      'Translation instructions',
    ),
  });
  const hint = h('p', {
    class: 'help',
    text: t(
      'settings.admin.translationInstructions.hint',
      'These instructions are sent with every AI translation. Use them for organization terminology and target-language style. Each field may contain up to {max} characters.',
      { max: TRANSLATION_INSTRUCTION_MAX_LENGTH.toLocaleString() },
    ),
  });
  const terminology = h('textarea', {
    class: 'form-input',
    name: 'terminology',
    rows: 6,
    maxlength: String(TRANSLATION_INSTRUCTION_MAX_LENGTH),
  });
  const terminologyError = createInlineError();
  const terminologyField = h('div', { class: 'stack' }, [
    h('label', { class: 'field-row' }, [
      h('span', {
        class: 'field-row-label',
        text: t(
          'settings.admin.translationInstructions.terminology',
          'Terminology',
        ),
      }),
      terminology,
    ]),
    terminologyError.el,
  ]);
  const styleHeading = h('h4', {
    class: 'field-label',
    text: t(
      'settings.admin.translationInstructions.style',
      'Style by target language',
    ),
  });
  const styles = h('div', { class: 'stack gap-2' });
  const saveError = createInlineError({ callout: true });
  const save = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    text: t(
      'settings.admin.translationInstructions.save',
      'Save translation instructions',
    ),
  });
  card.append(
    heading,
    hint,
    terminologyField,
    styleHeading,
    styles,
    saveError.el,
    save,
  );

  /** @type {Map<string, {input: HTMLTextAreaElement, error: ReturnType<typeof createInlineError>}>} */
  const styleFields = new Map();
  let loaded = false;
  let busy = false;

  async function load() {
    if (loaded) return;
    loaded = true;
    try {
      const [app, org] = await Promise.all([
        fetchAppSettings(),
        fetchOrgSettings({ maxAgeMs: 0 }),
      ]);
      const instructions = org.translationInstructions || {};
      terminology.value = instructions.terminology || '';
      for (const lang of app.supportedSlideLangs || []) {
        const input = h('textarea', {
          class: 'form-input',
          name: `styleByLanguage.${lang}`,
          rows: 5,
          maxlength: String(TRANSLATION_INSTRUCTION_MAX_LENGTH),
        });
        input.value = instructions.styleByLanguage?.[lang] || '';
        const error = createInlineError();
        styles.append(
          h('div', { class: 'stack' }, [
            h('label', { class: 'field-row' }, [
              h('span', {
                class: 'field-row-label',
                text: getLangDisplayName(lang),
              }),
              input,
            ]),
            error.el,
          ]),
        );
        styleFields.set(lang, { input, error });
      }
    } catch (err) {
      saveError.show(err.message);
    }
  }

  save.addEventListener('click', async () => {
    if (busy) return;
    saveError.clear();
    terminologyError.clear();
    for (const { error } of styleFields.values()) error.clear();
    busy = true;
    save.disabled = true;
    try {
      await updateOrgSettings({
        translationInstructions: {
          terminology: terminology.value,
          styleByLanguage: Object.fromEntries(
            [...styleFields].map(([lang, { input }]) => [lang, input.value]),
          ),
        },
      });
      toast.success(t('settings.saved', 'Saved.'));
    } catch (err) {
      const field = err.details?.field;
      if (field === 'terminology')
        terminologyError.show(err.message, { control: terminology });
      else if (field?.startsWith('styleByLanguage.')) {
        const target = styleFields.get(field.slice('styleByLanguage.'.length));
        if (target) target.error.show(err.message, { control: target.input });
        else saveError.show(err.message);
      } else saveError.show(err.message);
    } finally {
      busy = false;
      save.disabled = false;
    }
  });

  return { el: card, load };
}
