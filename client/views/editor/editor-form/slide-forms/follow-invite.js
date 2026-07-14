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
    text: 'Deze "Follow-along invite" slide toont een QR-code waarmee je publiek kan meekijken in hun eigen taal en kan reageren op interactieve slides (polls, feedback). De slide wordt niet meegenomen in publiceren of exports. Je kunt hem uitzetten; hij blijft dan in de lijst staan (grijs) maar wordt overgeslagen tijdens presenteren.',
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
    h('div', { class: 'help', text: 'Gebruik deze slide tijdens presenteren' })
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
