import { fmtDate } from '../../../lib/format.js';
import { createModal } from '../../../lib/modal.js';
import { copyToClipboard, showCopyFallbackModal } from '../../../lib/clipboard.js';
import { t } from '../../../lib/ui-i18n.js';

function safeString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

async function copyText(text) {
  const str = String(text || '');
  const ok = await copyToClipboard(str);
  if (!ok) {
    showCopyFallbackModal(
      str,
      t('editor.conflict.copyPrompt', 'Copy your version (Ctrl/Cmd+C)')
    );
  }
  return true;
}

export function openConflictModal({
  h,
  root,
  pres,
  conflictDetails,
  openOverlayClosers,
} = {}) {
  const who = safeString(conflictDetails?.updatedBy || '');
  const when = conflictDetails?.modified
    ? fmtDate(conflictDetails.modified)
    : '';

  const hintText =
    who || when
      ? t(
          'editor.conflict.hint',
          'This presentation was saved by {who}{whenPart}.',
          {
            who:
              who ||
              t(
                'editor.conflict.someoneElse',
                'someone else'
              ),
            whenPart: when ? ` (${when})` : '',
          }
        )
      : t(
          'editor.conflict.hintFallback',
          'This presentation was saved by someone else.'
        );

  const modal = createModal(h, {
    title: t(
      'editor.conflict.title',
      'Could not save (conflict)'
    ),
    hint: hintText,
  });

  const help = h('div', {
    class: 'help',
    style: 'margin-bottom: 16px;',
    text: t(
      'editor.conflict.help',
      "Reload to get the latest version. If you're worried about losing your changes: copy your version as JSON first."
    ),
  });

  const row = h('div', { class: 'row is-wrap' });
  const btnCopy = h('button', {
    class: 'btn btn-secondary',
    text: t(
      'editor.conflict.copyMine',
      'Copy my version (JSON)'
    ),
    onclick: async () => {
      const ok = await copyText(
        JSON.stringify(pres, null, 2)
      );
      if (ok)
        btnCopy.textContent = t('common.copied', 'Copied');
      setTimeout(() => {
        btnCopy.textContent = t(
          'editor.conflict.copyMine',
          'Copy my version (JSON)'
        );
      }, 1600);
    },
  });
  const btnReload = h('button', {
    class: 'btn btn-primary',
    text: t('common.reload', 'Reload'),
    onclick: () => location.reload(),
  });
  row.append(btnCopy, btnReload);

  modal.content.append(help, row);
  modal.show(root, openOverlayClosers);
}