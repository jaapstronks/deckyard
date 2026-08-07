import { api } from '../../lib/api.js';
import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';

/**
 * Remote-control panel for the speaker-notes companion.
 *
 * Renders the Prev / Next / Goto controls that drive the live presenter session
 * over `/api/live-sessions/:id/control`. Visibility is gated by the session's
 * `controlEnabled` flag (toggled live via {@link setEnabled}).
 *
 * @param {object} opts
 * @param {string} opts.sessionId - live-session id to control.
 * @param {boolean} opts.enabled - initial visibility.
 * @param {(msg: unknown) => void} opts.flashHint - surface a transient error/hint.
 * @returns {{ el: HTMLElement, setEnabled: (v: boolean) => void }}
 */
export function createNotesControls({ sessionId, enabled, flashHint }) {
  const controls = h('div', {
    class: 'notes-controls',
    hidden: !enabled,
  });
  const prevBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notes.prev', 'Prev'),
  });
  const nextBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notes.next', 'Next'),
  });
  const gotoInput = h('input', {
    class: 'form-input notes-goto-input',
    placeholder: t('notes.gotoPlaceholder', 'Slide #'),
    inputmode: 'numeric',
  });
  const gotoBtn = h('button', {
    class: 'btn btn-secondary',
    text: t('notes.go', 'Go'),
  });

  const sendControl = async (body) => {
    await api(`/api/live-sessions/${sessionId}/control`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  prevBtn.onclick = async () => {
    try {
      await sendControl({ action: 'prev' });
    } catch (e) {
      flashHint(e?.message || e);
    }
  };
  nextBtn.onclick = async () => {
    try {
      await sendControl({ action: 'next' });
    } catch (e) {
      flashHint(e?.message || e);
    }
  };
  gotoBtn.onclick = async () => {
    const n = Number(String(gotoInput.value || '').trim());
    if (!Number.isFinite(n) || n < 1) return;
    try {
      await sendControl({ action: 'goto', slideIndex: n - 1 });
    } catch (e) {
      flashHint(e?.message || e);
    }
  };
  controls.append(
    h('div', { class: 'help', text: t('notes.remoteControl', 'Remote control') }),
    h('div', { class: 'row' }, [
      prevBtn,
      nextBtn,
      gotoInput,
      gotoBtn,
    ])
  );

  return {
    el: controls,
    setEnabled(v) {
      controls.hidden = !v;
    },
  };
}
