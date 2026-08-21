import { t } from '../../../../lib/ui-i18n.js';
import { resolveDeckLang } from '../../../../../shared/i18n-utils.js';
import { h } from '../../../../lib/dom.js';

export function renderFollowInviteForm({
  form,
  pres,
  slide,
  fieldText,
  fieldTextarea,
  markDirty,
  rerenderSlideList,
  rerenderPreview,
  scheduleUiRefresh,
} = {}) {
  if (!slide.content || typeof slide.content !== 'object') slide.content = {};

  // The copy below is what this version's invite renders, so it is labelled
  // with the version's own language. It used to read `content.targetLang`,
  // which was the *other* language — the fields said "(Engels)" while editing
  // the Dutch invite. Those keys are gone; the renderer's own resolution
  // (resolveDeckLang, active version first) is the answer.
  const copyLang = resolveDeckLang(pres) || 'nl';
  const copyLangLabel = copyLang === 'en-GB' ? 'Engels' : 'Nederlands';

  const expl = h('div', {
    class: 'help editor-callout',
    text: t(
      'editor.followInvite.explanation',
      'This "Follow-along invite" slide shows a QR code that lets your audience follow along in their own language and respond to interactive slides (polls, feedback). The slide is left out of publishing and exports. You can switch it off; it then stays in the list (greyed out) but is skipped while presenting.',
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
      text: t(
        'editor.followInvite.useWhilePresenting',
        'Use this slide while presenting',
      ),
    }),
  );
  form.append(toggleRow);

  form.append(
    fieldText(
      `Titel (${copyLangLabel})`,
      slide.content.customTitle || '',
      (v) => {
        slide.content.customTitle = v;
        markDirty?.();
        scheduleUiRefresh?.();
      },
    ),
  );
  form.append(
    fieldTextarea(
      `Tekst (${copyLangLabel})`,
      slide.content.customBody || '',
      'Leeg laten = standaardtekst.',
      (v) => {
        slide.content.customBody = v;
        markDirty?.();
        scheduleUiRefresh?.();
      },
    ),
  );
}
