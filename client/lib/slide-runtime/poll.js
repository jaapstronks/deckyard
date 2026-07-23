import { h } from '../dom.js';
import qrcode from '../../vendor/qrcode-generator.js';
import { newId } from '../util/id.js';
import { storage } from '../storage.js';

export function getOrCreateVoterId() {
  const KEY = 'poll.voterId';
  const existing = storage.get(KEY, '').trim();
  if (existing) return existing;
  const v = newId();
  storage.set(KEY, v);
  return v;
}

// NOTE: Polls were removed as a standalone feature, but we keep QR helpers in this file
// (used by follow-invite slides). Voter/answer helpers remain for potential future
// follow-native interactions, but are currently unused.

export function renderQrToCanvas(canvas, text, { pad = 12, maxPx = 560 } = {}) {
  try {
    const qr = qrcode(0, 'M');
    qr.addData(String(text || ''));
    qr.make();

    const count = qr.getModuleCount();
    const ctx = canvas?.getContext?.('2d');
    if (!ctx) return false;

    const scale = Math.max(2, Math.floor((maxPx - pad * 2) / count));
    const size = count * scale + pad * 2;

    canvas.width = size;
    canvas.height = size;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = '#000';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (!qr.isDark(r, c)) continue;
        ctx.fillRect(pad + c * scale, pad + r * scale, scale, scale);
      }
    }
    return true;
  } catch {
    return false;
  }
}

export function createQrDataUrl(text, { size = 320 } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(String(text || ''));
  qr.make();
  const count = Math.max(1, Number(qr.getModuleCount() || 0) || 1);
  // `margin` for createDataURL is in pixels (not modules).
  const cellSize = Math.max(2, Math.floor(size / count));
  const raw = count * cellSize;
  const margin = Math.max(0, Math.floor((size - raw) / 2));
  return qr.createDataURL(cellSize, margin);
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function mountPollBars(barsEl, { options = [] } = {}) {
  const opts = Array.isArray(options) ? options : [];
  barsEl.innerHTML = '';

  const rows = opts.map((label, idx) => {
    const row = h('div', { class: 'poll-bar-row' });
    const name = h('div', { class: 'poll-bar-name', text: label || `Optie ${idx + 1}` });
    const track = h('div', { class: 'poll-bar-track' });
    const fill = h('div', { class: 'poll-bar-fill' });
    const count = h('div', { class: 'poll-bar-count' });
    const countNum = h('span', { class: 'poll-bar-count-num', text: '0' });
    const countPct = h('span', { class: 'poll-bar-count-pct', text: '0%' });
    count.append(countNum, h('span', { class: 'poll-bar-count-sep', text: ' · ' }), countPct);
    track.append(fill);
    row.append(name, track, count);
    barsEl.append(row);
    return { fill, countNum, countPct };
  });

  const update = ({ counts = [], total = 0 } = {}) => {
    const t = Math.max(0, Number(total || 0) || 0);
    for (let i = 0; i < rows.length; i += 1) {
      const c = Math.max(0, Number(counts?.[i] || 0) || 0);
      const pct = t > 0 ? (c / t) * 100 : 0;
      rows[i].fill.style.width = `${clamp(pct, 0, 100)}%`;
      rows[i].countNum.textContent = String(c);
      rows[i].countPct.textContent = `${Math.round(pct)}%`;
    }
  };

  update({ counts: [], total: 0 });
  return { update };
}

export function withBackoff(connectFn, { onStatus } = {}) {
  let stopped = false;
  let attempt = 0;
  let currentCleanup = null;

  const stop = () => {
    stopped = true;
    attempt = 0;
    if (typeof currentCleanup === 'function') {
      try {
        currentCleanup();
      } catch {}
    }
    currentCleanup = null;
  };

  const start = () => {
    const run = () => {
      if (stopped) return;
      const delay = Math.min(30_000, 600 * 2 ** attempt);
      if (attempt > 0) setTimeout(() => !stopped && runNow(), delay);
      else runNow();
    };
    const runNow = () => {
      if (stopped) return;
      attempt += 1;
      onStatus?.({ kind: 'connecting', attempt });
      try {
        currentCleanup = connectFn({
          onOpen: () => {
            attempt = 0;
            onStatus?.({ kind: 'open' });
          },
          onError: () => {
            onStatus?.({ kind: 'error' });
            if (typeof currentCleanup === 'function') {
              try {
                currentCleanup();
              } catch {}
            }
            currentCleanup = null;
            if (!stopped) run();
          },
        });
      } catch {
        onStatus?.({ kind: 'error' });
        if (!stopped) run();
      }
    };
    run();
  };

  return { start, stop };
}
