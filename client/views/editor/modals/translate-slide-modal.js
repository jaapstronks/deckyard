export async function openTranslateSlideModal({
  slideId,
  h,
  api,
  id,
  pres,
  SLIDE_TYPES,
  toast,
  root,
  lockDocumentScroll,
  openOverlayClosers,
  normalizeLang,
  otherLang,
  translatableKeysForType,
  markDirty,
  rerenderEditor,
  rerenderPreview,
  requestSave,
} = {}) {
  const { t } = await import('../../../lib/ui-i18n.js');
  const sid = String(slideId || '').trim();
  if (!sid) return;
  const targetLang = normalizeLang?.(pres?.i18n?.active) || 'nl';
  const sourceLang = otherLang?.(targetLang);
  if (!sourceLang) {
    toast?.info(t('editor.translate.disabled', 'Translation is disabled (only one language enabled).'), {
      id: 'slide-translate',
      durationMs: 2400,
    });
    return;
  }
  const slide = (pres?.slides || []).find((s) => s?.id === sid);
  if (!slide) return;
  const srcVersion = pres?.i18n?.versions?.[sourceLang];
  const srcSlide = Array.isArray(srcVersion?.slides)
    ? srcVersion.slides.find((s) => s?.id === sid)
    : null;
  if (!srcSlide) {
    toast?.info(
      sourceLang === 'nl'
        ? 'Bronversie (NL) ontbreekt voor deze slide. Gebruik “Vertalen” om die te maken.'
        : 'Source version (EN) is missing for this slide. Use “Vertalen” to create it.',
      { id: 'slide-translate', durationMs: 2600 }
    );
    return;
  }

  const keys = translatableKeysForType?.(slide?.type) || [];
  const srcContent =
    srcSlide?.content && typeof srcSlide.content === 'object'
      ? srcSlide.content
      : {};
  const fields = {};
  for (const k of keys) {
    const v = srcContent[k];
    if (typeof v === 'string' && v.trim()) fields[k] = v;
  }
  if (Object.keys(fields).length === 0) {
    toast?.info(t('editor.translate.noSourceText', 'No source text found to translate on this slide.'), {
      id: 'slide-translate',
      durationMs: 2200,
    });
    return;
  }

  let translations = {};
  try {
    const { readPreferredLlmVendor } = await import('../../../lib/net/llm-vendor.js');
    const vendor = readPreferredLlmVendor?.() || null;
    const resp = await api?.(
      `/api/presentations/${id}/translate/fields`,
      {
        method: 'POST',
        body: JSON.stringify({
          from: sourceLang,
          to: targetLang,
          fields,
          ...(vendor ? { vendor } : {}),
        }),
      }
    );
    translations =
      resp?.translations && typeof resp.translations === 'object'
        ? resp.translations
        : {};
  } catch (e) {
    toast?.error(String(e?.message || e), {
      id: 'slide-translate',
    });
    return;
  }

  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', {
    class: 'modal translate-slide-modal',
  });
  const unlockScroll = lockDocumentScroll?.();

  const close = () => {
    try {
      unlockScroll?.();
    } catch {}
    try {
      backdrop.remove();
    } finally {
      openOverlayClosers?.delete(close);
    }
  };
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });

  const header = h('div', {
    class: 'row spread',
  });
  header.append(
    h('h2', {
      text:
        targetLang === 'nl'
          ? t('editor.slide.fillTranslationToNl', 'Fill slide (translation) → NL')
          : t('editor.slide.fillTranslationToEn', 'Fill slide (translation) → EN'),
    }),
    h('button', {
      class: 'btn btn-secondary',
      text: t('common.close', 'Close'),
      onclick: () => close(),
    })
  );

  const hint = h('div', {
    class: 'help modal-hint-lg',
    text:
      targetLang === 'nl'
        ? t(
            'editor.translate.previewNl',
            'Preview of the translation. Click “Apply” to fill this (NL) slide from the other language.'
          )
        : t(
            'editor.translate.previewEn',
            'Preview of the translation. Click “Apply” to fill this (EN) slide from the other language.'
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
    const toText =
      typeof translations?.[k] === 'string' ? translations[k] : '';
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
            text:
              sourceLang === 'nl'
                ? t('editor.translate.sourceNl', 'NL (source)')
                : t('editor.translate.sourceEn', 'EN (source)'),
          }),
          h('div', {
            class: 'is-pre-wrap',
            text: fromText,
          }),
          h('div', {
            class: 'help is-mt-8',
            text:
              targetLang === 'nl'
                ? t('editor.translate.targetNl', 'NL (target)')
                : t('editor.translate.targetEn', 'EN (target)'),
          }),
          h('div', {
            class: 'is-pre-wrap',
            text: toText || t('common.emDash', '—'),
          }),
        ]
      )
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
      toast?.error(String(e?.message || e), {
        id: 'slide-translate',
      });
    }
  });
  btnRow.append(btnApply);

  modal.append(header, hint, list, btnRow);
  backdrop.append(modal);
  root.append(backdrop);
  openOverlayClosers?.add(close);
}
