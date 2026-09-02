import { createModal } from '../../../lib/dom/modal.js';
import { t } from '../../../lib/ui-i18n.js';
import { readPreferredLlmVendor } from '../../../lib/net/llm-vendor.js';
import { h } from '../../../lib/dom.js';
import {
  DEFAULT_DECK_LANG,
  getLangDisplayName,
  translationSourceFor,
} from '../../../../shared/i18n-utils.js';

export async function openTranslateSlideModal({
  slideId,
  api,
  id,
  pres,
  SLIDE_TYPES,
  toast,
  root,
  lockDocumentScroll,
  normalizeLang,
  perLanguageKeysForSlide,
  markDirty,
  rerenderEditor,
  rerenderPreview,
  requestSave,
} = {}) {
  const sid = String(slideId || '').trim();
  if (!sid) return;
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
        id: 'slide-translate',
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
      { id: 'slide-translate', durationMs: 2600 },
    );
    return;
  }

  const srcContent =
    srcSlide?.content && typeof srcSlide.content === 'object'
      ? srcSlide.content
      : {};
  const tgtContent =
    slide?.content && typeof slide.content === 'object' ? slide.content : {};
  // An undeclared string is prose in the source version too, so it belongs in
  // the fields offered for translation (D79).
  const keys =
    perLanguageKeysForSlide?.(slide?.type, srcContent, tgtContent) || [];
  const fields = {};
  for (const k of keys) {
    const v = srcContent[k];
    if (typeof v === 'string' && v.trim()) fields[k] = v;
  }
  if (Object.keys(fields).length === 0) {
    toast?.info(
      t(
        'editor.translate.noSourceText',
        'No source text found to translate on this slide.',
      ),
      {
        id: 'slide-translate',
        durationMs: 2200,
      },
    );
    return;
  }

  let translations = {};
  try {
    const vendor = readPreferredLlmVendor?.() || null;
    const resp = await api?.(`/api/presentations/${id}/translate/fields`, {
      method: 'POST',
      body: JSON.stringify({
        from: sourceLang,
        to: targetLang,
        fields,
        ...(vendor ? { vendor } : {}),
      }),
    });
    translations =
      resp?.translations && typeof resp.translations === 'object'
        ? resp.translations
        : {};
  } catch (e) {
    toast?.error(e, {
      id: 'slide-translate',
    });
    return;
  }

  const unlockScroll = lockDocumentScroll?.();

  const modal = createModal({
    title: t(
      'editor.slide.fillTranslationTo',
      'Fill slide (translation) → {lang}',
      { lang: targetLabel },
    ),
    modalClass: 'translate-slide-modal',
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
      'editor.translate.preview',
      'Preview of the translation. Click “Apply” to fill this ({target}) slide from {source}.',
      { target: targetLabel, source: sourceLabel },
    ),
  });

  const def = SLIDE_TYPES?.[slide?.type];
  const labelForKey = (k) => {
    const f = Array.isArray(def?.fields)
      ? def.fields.find((x) => x?.key === k)
      : null;
    return t(f?.labelKey || k, String(f?.label || k));
  };

  const list = h('div', {
    class: 'stack is-gap-lg translate-preview-list',
  });
  for (const k of keys) {
    if (!(k in fields)) continue;
    const fromText = String(fields[k] || '');
    const toText = typeof translations?.[k] === 'string' ? translations[k] : '';
    list.append(
      h(
        'div',
        {
          class: 'stack editor-card',
        },
        [
          h('div', {
            class: 'field-label',
            text: labelForKey(k),
          }),
          h('div', {
            class: 'help',
            text: t('editor.translate.sourcePill', '{lang} (source)', {
              lang: sourceLabel,
            }),
          }),
          h('div', {
            class: 'is-pre-wrap',
            text: fromText,
          }),
          h('div', {
            class: 'help is-mt-8',
            text: t('editor.translate.targetPill', '{lang} (target)', {
              lang: targetLabel,
            }),
          }),
          h('div', {
            class: 'is-pre-wrap',
            text: toText || t('common.emDash', '—'),
          }),
        ],
      ),
    );
  }

  const btnRow = h('div', {
    class: 'row is-end modal-actions-lg',
  });
  const btnApply = h('button', {
    class: 'btn btn-primary',
    text: t('common.apply', 'Apply'),
  });
  btnApply.addEventListener('click', async () => {
    try {
      for (const [k, v] of Object.entries(translations)) {
        if (typeof v !== 'string') continue;
        slide.content[k] = v;
      }

      markDirty?.();
      rerenderEditor?.();
      rerenderPreview?.();
      await requestSave?.();
      close();
      toast?.success(t('editor.translate.slideFilled', 'Slide filled.'), {
        id: 'slide-translate',
        durationMs: 1800,
      });
    } catch (e) {
      toast?.error(e, {
        id: 'slide-translate',
      });
    }
  });
  btnRow.append(btnApply);

  modal.append(hint, list, btnRow);
  modal.show(root);
}
