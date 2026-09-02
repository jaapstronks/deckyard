import { t } from '../../../../lib/ui-i18n.js';
import {
  DEFAULT_DECK_LANG,
  getLangDisplayName,
  resolveDeckLang,
} from '../../../../../shared/i18n-utils.js';
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
  // (resolveDeckLang, active version first) is the answer. The label comes off
  // the axis for the same reason: a `copyLang === 'en-GB' ? … : …` ternary
  // called a French invite "Nederlands" (B182 fase 3).
  const copyLang = resolveDeckLang(pres) || DEFAULT_DECK_LANG;
  const copyLangLabel = getLangDisplayName(copyLang);

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
      t('editor.followInvite.titleField', 'Title ({lang})', {
        lang: copyLangLabel,
      }),
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
      t('editor.followInvite.bodyField', 'Text ({lang})', {
        lang: copyLangLabel,
      }),
      slide.content.customBody || '',
      t('editor.followInvite.bodyHelp', 'Leave empty for the default text.'),
      (v) => {
        slide.content.customBody = v;
        markDirty?.();
        scheduleUiRefresh?.();
      },
    ),
  );
}
