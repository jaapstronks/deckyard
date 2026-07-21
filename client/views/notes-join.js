import { h } from '../lib/dom.js';
import qrcode from '../vendor/qrcode-generator.js';
import { t } from '../lib/ui-i18n.js';
import { copyToClipboardWithPromptFallback } from '../lib/util/clipboard.js';

function renderQrToCanvas(canvas, text, { pad = 12 } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text || ''));
  qr.make();

  const count = qr.getModuleCount();
  const ctx = canvas.getContext('2d');

  const maxPx = Math.min(
    560,
    Math.max(220, window.innerWidth - 40)
  );
  const scale = Math.max(
    2,
    Math.floor((maxPx - pad * 2) / count)
  );
  const size = count * scale + pad * 2;

  canvas.width = size;
  canvas.height = size;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#000';
  for (let r = 0; r < count; r += 1) {
    for (let c = 0; c < count; c += 1) {
      if (!qr.isDark(r, c)) continue;
      ctx.fillRect(
        pad + c * scale,
        pad + r * scale,
        scale,
        scale
      );
    }
  }
}

export async function renderNotesJoin(
  root,
  sessionId,
  { nav } = {}
) {
  const u = new URL(`/notes/${sessionId}`, location.origin);
  const url = u.toString();

  const shell = h('div', { class: 'join-shell' });
  const panel = h('div', { class: 'panel join-panel' });
  const title = h('h2', { text: t('notesJoin.title', 'Notes companion') });
  const help = h('div', {
    class: 'help',
    text: t(
      'notesJoin.help',
      'Scan the QR code on your phone to open the notes companion.'
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
        t('notesJoin.copyPrompt', 'Copy this link:')
      );
    },
  });
  const openBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notesJoin.open', 'Open companion'),
    onclick: () => {
      const dest = u.pathname + u.search;
      if (typeof nav === 'function') nav(dest);
      else location.href = dest;
    },
  });
  const backBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('common.close', 'Close'),
    onclick: () => {
      try {
        window.close();
      } catch {}
      if (typeof nav === 'function') nav('/app');
      else location.href = '/app';
    },
  });

  panel.append(title, help, canvas, link);
  panel.append(
    h('div', { class: 'row is-wrap' }, [
      copyBtn,
      openBtn,
      backBtn,
    ])
  );
  shell.append(panel);
  root.append(shell);

  const rerenderQr = () => {
    try {
      renderQrToCanvas(canvas, url);
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
