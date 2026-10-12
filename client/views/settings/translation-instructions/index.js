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

/** @returns {{el: HTMLElement, load: () => Promise<void>, syncSupportedLanguages: (languages: string[]) => void}} */
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
    disabled: true,
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

  /** @type {Map<string, {el: HTMLElement, input: HTMLTextAreaElement, error: ReturnType<typeof createInlineError>}>} */
  const styleFields = new Map();
  let loaded = false;
  let busy = false;
  let loadPromise;
  let supportedLanguages;
  let activeLanguages = [];
  let initialStyles = {};

  function syncSupportedLanguages(languages) {
    supportedLanguages = [...languages];
    if (!loaded) return;
    activeLanguages = supportedLanguages;
    styles.replaceChildren();
    for (const lang of activeLanguages) {
      if (!styleFields.has(lang)) {
        const input = h('textarea', {
          class: 'form-input',
          name: `styleByLanguage.${lang}`,
          rows: 5,
          maxlength: String(TRANSLATION_INSTRUCTION_MAX_LENGTH),
        });
        input.value = initialStyles[lang] || '';
        const error = createInlineError();
        const el = h('div', { class: 'stack' }, [
          h('label', { class: 'field-row' }, [
            h('span', {
              class: 'field-row-label',
              text: getLangDisplayName(lang),
            }),
            input,
          ]),
          error.el,
        ]);
        styleFields.set(lang, { el, input, error });
      }
      styles.append(styleFields.get(lang).el);
    }
  }

  async function load() {
    if (loaded) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      try {
        const [app, org] = await Promise.all([
          fetchAppSettings(),
          fetchOrgSettings({ maxAgeMs: 0 }),
        ]);
        const instructions = org.translationInstructions || {};
        terminology.value = instructions.terminology || '';
        initialStyles = instructions.styleByLanguage || {};
        loaded = true;
        syncSupportedLanguages(
          supportedLanguages || app.supportedSlideLangs || [],
        );
        saveError.clear();
        save.disabled = false;
      } catch (err) {
        saveError.show(err.message);
      } finally {
        loadPromise = undefined;
      }
    })();
    return loadPromise;
  }

  save.addEventListener('click', async () => {
    if (busy || !loaded) return;
    saveError.clear();
    terminologyError.clear();
    for (const lang of activeLanguages) styleFields.get(lang).error.clear();
    busy = true;
    save.disabled = true;
    try {
      await updateOrgSettings({
        translationInstructions: {
          terminology: terminology.value,
          styleByLanguage: Object.fromEntries(
            activeLanguages.map((lang) => [
              lang,
              styleFields.get(lang).input.value,
            ]),
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
      save.disabled = !loaded;
    }
  });

  return { el: card, load, syncSupportedLanguages };
}
