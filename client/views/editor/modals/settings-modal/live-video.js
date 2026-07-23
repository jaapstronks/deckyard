import { t } from '../../../../lib/ui-i18n.js';
import {
  detectStreamProvider,
  POSITION_PRESET_LABELS,
  MOBILE_POSITIONS,
} from '../../../../../shared/video-stream-providers.js';

/**
 * Live Video overlay: enable toggle plus stream URL, provider detection, and
 * default/mobile position presets (fields hidden while disabled).
 * @param {object} ctx - { h, pres, markDirty, requestSave }
 * @returns {{ el: HTMLElement }}
 */
export function buildLiveVideoSection({ h, pres, markDirty, requestSave }) {
  pres.settings.liveVideo =
    pres.settings.liveVideo && typeof pres.settings.liveVideo === 'object'
      ? pres.settings.liveVideo
      : {};
  pres.settings.liveVideo.enabled = !!pres.settings.liveVideo.enabled;
  pres.settings.liveVideo.streamUrl = String(
    pres.settings.liveVideo.streamUrl || ''
  );
  pres.settings.liveVideo.provider = String(
    pres.settings.liveVideo.provider || ''
  );
  pres.settings.liveVideo.defaultPosition = String(
    pres.settings.liveVideo.defaultPosition || 'pip-top-right'
  );
  pres.settings.liveVideo.mobilePosition = String(
    pres.settings.liveVideo.mobilePosition || 'bottom'
  );

  const wrap = h('div', { class: 'stack editor-callout' });
  const label = h('div', {
    class: 'field-label',
    text: t('editor.deckSettings.liveVideo.title', 'Live Video'),
  });

  // Enable toggle
  const enableRow = h('label', {
    class: 'row is-start is-gap-xs',
    style: 'margin-top: var(--ps-space-2);',
  });
  const enableCb = h('input', { type: 'checkbox' });
  enableCb.checked = pres.settings.liveVideo.enabled;
  enableRow.append(
    enableCb,
    h('span', {
      text: t('editor.deckSettings.liveVideo.enable', 'Enable video overlay'),
    })
  );
  enableCb.addEventListener('change', () => {
    pres.settings.liveVideo.enabled = !!enableCb.checked;
    fields.style.display = enableCb.checked ? '' : 'none';
    markDirty?.();
    requestSave?.();
  });

  // Fields container (hidden when disabled)
  const fields = h('div', {
    class: 'stack is-gap-xs',
    style: enableCb.checked ? '' : 'display:none;',
  });

  // Stream URL input
  const urlLabel = h('div', {
    class: 'help',
    text: t(
      'editor.deckSettings.liveVideo.urlHelp',
      'Paste a YouTube Live, Vimeo, Bunny, Mux, Cloudflare, or HLS stream URL.'
    ),
  });
  const urlInput = h('input', {
    type: 'url',
    class: 'form-input',
    placeholder: 'https://www.youtube.com/watch?v=...',
    value: pres.settings.liveVideo.streamUrl,
  });
  const providerHint = h('div', { class: 'help', text: '' });
  const syncProviderHint = () => {
    const url = String(urlInput.value || '').trim();
    const prov = url ? detectStreamProvider(url) : null;
    if (prov) {
      pres.settings.liveVideo.provider = prov;
      providerHint.textContent = t(
        'editor.deckSettings.liveVideo.detected',
        'Detected: {provider}',
        { provider: prov }
      );
    } else if (url) {
      pres.settings.liveVideo.provider = '';
      providerHint.textContent = t(
        'editor.deckSettings.liveVideo.unrecognized',
        'Unrecognized URL. Supported: YouTube, Vimeo, Bunny, Mux, Cloudflare, .m3u8'
      );
    } else {
      pres.settings.liveVideo.provider = '';
      providerHint.textContent = '';
    }
  };
  syncProviderHint();
  urlInput.addEventListener('input', () => {
    pres.settings.liveVideo.streamUrl = String(urlInput.value || '').trim();
    syncProviderHint();
    markDirty?.();
  });
  urlInput.addEventListener('blur', () => {
    requestSave?.();
  });

  // Default position preset
  const posLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.liveVideo.position', 'Default position'),
  });
  const posSel = h('select', { class: 'form-input' });
  for (const [value, label2] of Object.entries(POSITION_PRESET_LABELS)) {
    posSel.append(h('option', { value, text: label2 }));
  }
  posSel.value = pres.settings.liveVideo.defaultPosition;
  posSel.addEventListener('change', () => {
    pres.settings.liveVideo.defaultPosition = String(
      posSel.value || 'pip-top-right'
    );
    markDirty?.();
    requestSave?.();
  });

  // Mobile position
  const mobilePosLabel = h('div', {
    class: 'help',
    text: t('editor.deckSettings.liveVideo.mobilePosition', 'Mobile position'),
  });
  const mobilePosSel = h('select', { class: 'form-input' });
  for (const [value, label2] of Object.entries(MOBILE_POSITIONS)) {
    mobilePosSel.append(h('option', { value, text: label2 }));
  }
  mobilePosSel.value = pres.settings.liveVideo.mobilePosition;
  mobilePosSel.addEventListener('change', () => {
    pres.settings.liveVideo.mobilePosition = String(
      mobilePosSel.value || 'bottom'
    );
    markDirty?.();
    requestSave?.();
  });

  fields.append(
    urlLabel,
    urlInput,
    providerHint,
    posLabel,
    posSel,
    mobilePosLabel,
    mobilePosSel
  );
  wrap.append(label, enableRow, fields);
  return { el: wrap };
}
