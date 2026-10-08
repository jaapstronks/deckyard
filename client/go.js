/**
 * Go Page - Follow Code Entry
 *
 * Standalone script for the /go page that handles follow code entry. A visitor
 * here has no session and no deck yet, so the page speaks the browser's
 * language, else the installation default (D322); `go.html` carries the
 * English that shows before this script runs.
 */

import { api } from './lib/api.js';
import { applyViewerUiLocale, t } from './lib/ui-i18n.js';
import { debugLog } from './lib/util/debug.js';

function $id(id) {
  return document.getElementById(id);
}

const form = $id('goForm');
const input = $id('goCode');
const submit = $id('goSubmit');
const errorEl = $id('goError');

// t() is read at use time: the dictionary loads after the handlers are
// attached, and until then it answers with the English fallback.

/** Put the page's static copy in the resolved language. */
function applyPageCopy() {
  const kicker = t('go.kicker', 'Follow along');
  document.title = kicker;
  const set = (selector, text) => {
    const el = document.querySelector(selector);
    if (el) el.textContent = text;
  };
  set('.go-kicker', kicker);
  set('.go-title', t('go.title', 'Enter code'));
  set('.go-label', t('go.label', 'Session code'));
  set(
    '.go-help',
    t('go.help', 'Enter the code shown on the presentation screen.'),
  );
  if (submit) submit.textContent = t('common.continue', 'Continue');
}

function setError(msg) {
  errorEl.textContent = msg ? String(msg) : '';
}

function sanitizeCode(raw) {
  return String(raw || '')
    .replace(/[^a-zA-Z]/g, '')
    .toUpperCase()
    .slice(0, 6);
}

input?.addEventListener('input', () => {
  const next = sanitizeCode(input.value);
  if (input.value !== next) input.value = next;
  setError('');
});

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setError('');

  const code = sanitizeCode(input?.value || '');
  if (code.length < 4 || code.length > 6) {
    setError(t('go.enterCode', 'Enter the session code.'));
    input?.focus?.();
    return;
  }

  submit.disabled = true;
  const prevText = submit.textContent;
  submit.textContent = t('common.loading', 'Loading…');

  try {
    const data = await api(`/api/follow-codes/${encodeURIComponent(code)}`);
    if (data && typeof data.followUrl === 'string' && data.followUrl) {
      window.location.href = data.followUrl;
      return;
    }
    setError(t('go.codeNotFound', 'Code not found or expired.'));
  } catch (err) {
    // A response error carries a statusCode and the envelope's human message;
    // without one the request itself failed (network).
    if (err?.statusCode)
      setError(
        err.message || t('go.codeNotFound', 'Code not found or expired.'),
      );
    else setError(t('go.networkError', 'Network error. Please try again.'));
  } finally {
    submit.disabled = false;
    submit.textContent = prevText || t('common.continue', 'Continue');
  }
});

input?.focus?.();

// Without a dictionary the English in go.html stays and the page still works.
applyViewerUiLocale()
  .then(applyPageCopy)
  .catch((err) => debugLog('go: interface language not applied', err));
