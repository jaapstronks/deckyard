export async function openTranslateFieldModal({
  slideId,
  key,
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
  markDirty,
  rerenderEditor,
  rerenderPreview,
  requestSave,
} = {}) {
  const { t } = await import('../../../lib/ui-i18n.js');
  const sid = String(slideId || '').trim();
  const k = String(key || '').trim();
  if (!sid || !k) return;
  const targetLang = normalizeLang?.(pres?.i18n?.active) || 'nl';
  const sourceLang = otherLang?.(targetLang);
  if (!sourceLang) {
    toast?.info('Vertalen is uitgeschakeld (slechts één taal actief).', {
      id: 'field-translate',
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
      { id: 'field-translate', durationMs: 2600 }
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
  const srcText =
    typeof srcContent?.[k] === 'string' ? srcContent[k] : '';
  if (!String(srcText || '').trim()) {
    toast?.info('Brontaal veld is leeg; niets om te vertalen.', {
      id: 'field-translate',
      durationMs: 1800,
    });
    return;
  }

  let translated = '';
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
          fields: { [k]: srcText },
          ...(vendor ? { vendor } : {}),
        }),
      }
    );
    translated =
      typeof resp?.translations?.[k] === 'string'
        ? resp.translations[k]
        : '';
  } catch (e) {
    toast?.error(String(e?.message || e), {
      id: 'field-translate',
    });
    return;
  }

  const backdrop = h('div', { class: 'modal-backdrop' });
  const modal = h('div', {
    class: 'modal translate-field-modal',
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
          ? `Vul veld (vertaling) → NL`
          : `Fill field (translation) → EN`,
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
        ? `Vul alleen “${fieldLabel}” (NL) met een vertaling vanuit de andere taal.`
        : `Fill only “${fieldLabel}” (EN) with a translation from the other language.`,
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
        text: sourceLang === 'nl' ? 'NL (bron)' : 'EN (source)',
      }),
      h('div', {
        class: 'is-pre-wrap',
        text: srcText,
      }),
      h('div', {
        class: 'help is-mt-8',
        text: targetLang === 'nl' ? 'NL (doel)' : 'EN (target)',
      }),
      h('div', {
        class: 'is-pre-wrap',
        text: translated || '—',
      }),
    ]
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
      toast?.success('Veld gevuld.', {
        id: 'field-translate',
        durationMs: 1600,
      });
    } catch (e) {
      toast?.error(String(e?.message || e), {
        id: 'field-translate',
      });
    }
  });
  btnRow.append(btnApply);

  modal.append(header, hint, card, btnRow);
  backdrop.append(modal);
  root.append(backdrop);
  openOverlayClosers?.add(close);
}
