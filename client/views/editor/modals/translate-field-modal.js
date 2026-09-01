import { createModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { readPreferredLlmVendor } from '../../../lib/net/llm-vendor.js';
import { h } from '../../../lib/dom.js';
import { getLangDisplayName } from '../../../lib/format/lang-selector.js';
import {
  DEFAULT_DECK_LANG,
  translationSourceFor,
} from '../../../../shared/i18n-utils.js';

export async function openTranslateFieldModal({
  slideId,
  key,
  api,
  id,
  pres,
  SLIDE_TYPES,
  toast,
  root,
  lockDocumentScroll,
  normalizeLang,
  markDirty,
  rerenderEditor,
  rerenderPreview,
  requestSave,
} = {}) {
  const sid = String(slideId || '').trim();
  const k = String(key || '').trim();
  if (!sid || !k) return;
  const targetLang = normalizeLang?.(pres?.i18n?.active) || DEFAULT_DECK_LANG;
  // The version this translation reads FROM: the dominant one, or - when the
  // dominant version IS the target - whichever other version the deck carries.
  // `otherLang()` answered this for a bilingual deck only (D72 #2).
  const sourceLang = translationSourceFor(pres, targetLang);
  if (!sourceLang) {
    toast?.info(
      t(
        'editor.translate.disabled',
        'Translation is disabled (only one language enabled).',
      ),
      {
        id: 'field-translate',
        durationMs: 2400,
      },
    );
    return;
  }
  // Both languages are named by their own native label, so the copy reads the
  // same for a `fr` version as for the `nl`/`en-GB` pair it used to hardcode.
  const sourceLabel = getLangDisplayName(sourceLang);
  const targetLabel = getLangDisplayName(targetLang);
  const slide = (pres?.slides || []).find((s) => s?.id === sid);
  if (!slide) return;
  const srcVersion = pres?.i18n?.versions?.[sourceLang];
  const srcSlide = Array.isArray(srcVersion?.slides)
    ? srcVersion.slides.find((s) => s?.id === sid)
    : null;
  if (!srcSlide) {
    toast?.info(
      t(
        'editor.translate.sourceSlideMissing',
        'The {lang} version has no version of this slide yet. Use “Translate” to create it.',
        { lang: sourceLabel },
      ),
      { id: 'field-translate', durationMs: 2600 },
    );
    return;
  }

  const def = SLIDE_TYPES?.[slide?.type];
  const f = Array.isArray(def?.fields)
    ? def.fields.find((x) => x?.key === k)
    : null;
  const fieldLabel = String(f?.label || k);

  const srcContent =
    srcSlide?.content && typeof srcSlide.content === 'object'
      ? srcSlide.content
      : {};
  const srcText = typeof srcContent?.[k] === 'string' ? srcContent[k] : '';
  if (!String(srcText || '').trim()) {
    toast?.info(
      t(
        'editor.translate.sourceFieldEmpty',
        'The source field is empty; nothing to translate.',
      ),
      {
        id: 'field-translate',
        durationMs: 1800,
      },
    );
    return;
  }

  let translated = '';
  try {
    const vendor = readPreferredLlmVendor?.() || null;
    const resp = await api?.(`/api/presentations/${id}/translate/fields`, {
      method: 'POST',
      body: JSON.stringify({
        from: sourceLang,
        to: targetLang,
        fields: { [k]: srcText },
        ...(vendor ? { vendor } : {}),
      }),
    });
    translated =
      typeof resp?.translations?.[k] === 'string' ? resp.translations[k] : '';
  } catch (e) {
    toast?.error(e, {
      id: 'field-translate',
    });
    return;
  }

  const unlockScroll = lockDocumentScroll?.();

  const modal = createModal({
    title: t(
      'editor.translate.fillFieldTitle',
      'Fill field (translation) → {lang}',
      { lang: targetLabel },
    ),
    modalClass: 'translate-field-modal',
    onClose: () => {
      try {
        unlockScroll?.();
      } catch {
        // ignore
      }
    },
  });
  const close = () => modal.close();

  const hint = h('div', {
    class: 'help modal-hint-lg',
    text: t(
      'editor.translate.fillFieldHint',
      'Fill only “{field}” ({target}) with a translation from {source}.',
      { field: fieldLabel, target: targetLabel, source: sourceLabel },
    ),
  });

  const card = h(
    'div',
    {
      class: 'stack editor-card',
    },
    [
      h('div', {
        class: 'field-label',
        text: fieldLabel,
      }),
      h('div', {
        class: 'help',
        text: t('editor.translate.sourcePill', '{lang} (source)', {
          lang: sourceLabel,
        }),
      }),
      h('div', {
        class: 'is-pre-wrap',
        text: srcText,
      }),
      h('div', {
        class: 'help is-mt-8',
        text: t('editor.translate.targetPill', '{lang} (target)', {
          lang: targetLabel,
        }),
      }),
      h('div', {
        class: 'is-pre-wrap',
        text: translated || t('common.emDash', '—'),
      }),
    ],
  );

  const btnRow = h('div', {
    class: 'row is-end modal-actions-lg',
  });
  const btnApply = h('button', {
    class: 'btn btn-primary',
    text: t('common.apply', 'Apply'),
  });
  btnApply.addEventListener('click', async () => {
    try {
      slide.content[k] = translated;

      markDirty?.();
      rerenderEditor?.();
      rerenderPreview?.();
      await requestSave?.();
      close();
      toast?.success(t('editor.translate.fieldFilled', 'Field filled.'), {
        id: 'field-translate',
        durationMs: 1600,
      });
    } catch (e) {
      toast?.error(e, {
        id: 'field-translate',
      });
    }
  });
  btnRow.append(btnApply);

  modal.append(hint, card, btnRow);
  modal.show(root);
}
