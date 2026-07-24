/**
 * Go Page - Follow Code Entry
 *
 * Standalone script for the /go page that handles follow code entry.
 * Uses data-* attributes on elements for i18n strings.
 */

function $id(id) {
  return document.getElementById(id);
}

const form = $id('goForm');
const input = $id('goCode');
const submit = $id('goSubmit');
const errorEl = $id('goError');

// Get i18n strings from data attributes or use defaults
const strings = {
  loading: submit?.dataset?.loading || 'Loading...',
  codeNotFound: errorEl?.dataset?.codeNotFound || 'Code not found or expired.',
  networkError: errorEl?.dataset?.networkError || 'Network error. Please try again.',
  enterCode: errorEl?.dataset?.enterCode || 'Enter the session code.',
  continueText: submit?.dataset?.continue || 'Continue',
};

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
    setError(strings.enterCode);
    input?.focus?.();
    return;
  }

  submit.disabled = true;
  const prevText = submit.textContent;
  submit.textContent = strings.loading;

  try {
    const res = await fetch(`/api/follow-codes/${encodeURIComponent(code)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && typeof data.followUrl === 'string' && data.followUrl) {
      window.location.href = data.followUrl;
      return;
    }
    // Tolerate both the canonical error envelope (message + machine code) and
    // legacy prose-in-error bodies: prefer the human message, fall back to error.
    setError((data && (data.message || data.error)) || strings.codeNotFound);
  } catch {
    setError(strings.networkError);
  } finally {
    submit.disabled = false;
    submit.textContent = prevText || strings.continueText;
  }
});

try {
  input?.focus?.();
} catch {
  // ignore
}