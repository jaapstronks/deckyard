/**
 * QR codes: one renderer for a canvas, one for a data URL.
 */

import qrcode from '../../vendor/qrcode-generator.js';

/**
 * Draw `text` as a QR code onto `canvas`, black on a white quiet zone.
 * @param {HTMLCanvasElement} canvas
 * @param {string} text
 * @param {{ pad?: number, maxPx?: number }} [opts] - quiet zone and largest side in px
 * @returns {boolean} false when the canvas has no 2D context or encoding failed
 */
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

/**
 * Encode `text` as a QR code PNG data URL of roughly `size` px square.
 * @param {string} text
 * @param {{ size?: number }} [opts]
 * @returns {string}
 */
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
