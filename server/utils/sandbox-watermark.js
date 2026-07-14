import { sandboxEnabled, sandboxWatermarkText } from '../config/sandbox.js';
import { escapeHtml } from '../../shared/slide-types/helpers.js';

export function sandboxWatermarkEnabled(explicit) {
  if (explicit === false) return false;
  if (explicit === true) return true;
  return sandboxEnabled();
}

export function sandboxWatermarkCss() {
  return `
    .ps-sandbox-watermark {
      position: absolute;
      right: 14px;
      bottom: 12px;
      z-index: 9999;
      pointer-events: none;
      user-select: none;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(0,0,0,0.48);
      color: rgba(255,255,255,0.92);
      border: 1px solid rgba(255,255,255,0.16);
      backdrop-filter: blur(8px);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      font-size: 12px;
      line-height: 1.2;
      letter-spacing: 0.01em;
      text-transform: none;
      max-width: 65%;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `.trim();
}

export function sandboxWatermarkHtml() {
  const txt = sandboxWatermarkText();
  return `<div class="ps-sandbox-watermark" aria-hidden="true">${escapeHtml(txt)}</div>`;
}
