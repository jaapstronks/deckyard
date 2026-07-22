import { t } from '../../../../lib/ui-i18n.js';

export function renderFollowInviteForm({
  h,
  form,
  slide,
  fieldText,
  fieldTextarea,
  markDirty,
  rerenderSlideList,
  rerenderPreview,
  scheduleUiRefresh,
} = {}) {
  if (!slide.content || typeof slide.content !== 'object') slide.content = {};

  const targetLangRaw = String(slide.content?.targetLang || '').trim();
  const targetLang = targetLangRaw === 'en-GB' ? 'en-GB' : 'nl';
  const targetLabel = targetLang === 'en-GB' ? 'Engels' : 'Nederlands';

  const expl = h('div', {
    class: 'help editor-callout',
    text: t(
      'editor.followInvite.explanation',
      'This "Follow-along invite" slide shows a QR code that lets your audience follow along in their own language and respond to interactive slides (polls, feedback). The slide is left out of publishing and exports. You can switch it off; it then stays in the list (greyed out) but is skipped while presenting.'
    ),
  });
  form.append(expl);

  const toggleRow = h('label', {
    class: 'row editor-toggle-row',
  });
  const cb = h('input', { type: 'checkbox' });
  cb.checked = slide.content.enabled !== false;
  cb.addEventListener('change', () => {
    slide.content.enabled = !!cb.checked;
    markDirty?.();
    rerenderSlideList?.();
    rerenderPreview?.();
    scheduleUiRefresh?.();
  });
  toggleRow.append(
    cb,
    h('div', {
      class: 'help',
      text: t('editor.followInvite.useWhilePresenting', 'Use this slide while presenting'),
    })
  );
  form.append(toggleRow);

  form.append(
    fieldText(`Titel (${targetLabel})`, slide.content.customTitle || '', (v) => {
      slide.content.customTitle = v;
      markDirty?.();
      scheduleUiRefresh?.();
    })
  );
  form.append(
    fieldTextarea(
      `Tekst (${targetLabel})`,
      slide.content.customBody || '',
      'Leeg laten = standaardtekst.',
      (v) => {
        slide.content.customBody = v;
        markDirty?.();
        scheduleUiRefresh?.();
      }
    )
  );
}
