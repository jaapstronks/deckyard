import { h } from '../../lib/dom/index.js';
import { t } from '../../lib/ui-i18n.js';
import { copyToClipboardWithPromptFallback } from '../../lib/dom/clipboard.js';
import { nav } from '../../lib/state/router.js';
import { renderQrToCanvas } from '../../lib/dom/qr.js';

export async function renderNotesJoin(root, sessionId) {
  const u = new URL(`/notes/${sessionId}`, location.origin);
  const url = u.toString();

  const shell = h('div', { class: 'join-shell' });
  const panel = h('div', { class: 'panel join-panel' });
  const title = h('h2', { text: t('notesJoin.title', 'Notes companion') });
  const help = h('div', {
    class: 'help',
    text: t(
      'notesJoin.help',
      'Scan the QR code on your phone to open the notes companion.',
    ),
  });

  const canvas = h('canvas', {
    class: 'join-qr',
    role: 'img',
    'aria-label': t('qr.alt', 'QR code'),
  });

  const link = h('div', {
    class: 'help join-link',
    text: url,
  });

  const copyBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notesJoin.copyLink', 'Copy link'),
    onclick: async () => {
      await copyToClipboardWithPromptFallback(
        url,
        t('notesJoin.copyPrompt', 'Copy this link:'),
      );
    },
  });
  const openBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notesJoin.open', 'Open companion'),
    onclick: () => {
      const dest = u.pathname + u.search;
      nav(dest);
    },
  });
  const backBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('common.close', 'Close'),
    onclick: () => {
      try {
        window.close();
      } catch {}
      nav('/app');
    },
  });

  panel.append(title, help, canvas, link);
  panel.append(h('div', { class: 'row is-wrap' }, [copyBtn, openBtn, backBtn]));
  shell.append(panel);
  root.append(shell);

  const rerenderQr = () => {
    try {
      renderQrToCanvas(canvas, url, {
        maxPx: Math.min(560, Math.max(220, window.innerWidth - 40)),
      });
    } catch {
      // If something goes wrong, at least keep the URL visible.
    }
  };
  rerenderQr();
  window.addEventListener('resize', rerenderQr);

  return () => {
    window.removeEventListener('resize', rerenderQr);
  };
}
