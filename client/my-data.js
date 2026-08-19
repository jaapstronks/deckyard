/**
 * my-data page — GDPR self-service landing page.
 *
 * Standalone script for `/my-data` (kept out of the SPA router, like `/go`).
 * Arriving from the verification email, the URL carries `?email=…&token=…`; the
 * page fetches the data, renders it, and offers a confirmed erase. With no
 * token it falls back to a request form so a bare `/my-data` visit is not a
 * dead end.
 *
 * All server-derived strings go in via `h()`'s `text` attribute (textContent) —
 * never innerHTML — so a crafted deck id or email cannot inject markup.
 */

import { h } from './lib/dom.js';
import { formatDate } from './lib/format/analytics-format.js';

function $id(id) {
  return document.getElementById(id);
}

const params = new URLSearchParams(window.location.search);
const email = (params.get('email') || '').trim();
const token = params.get('token') || '';

const loadingEl = $id('mdLoading');
const requestForm = $id('mdRequestForm');
const requestSubmit = $id('mdRequestSubmit');
const requestMsg = $id('mdRequestMsg');
const emailInput = $id('mdEmail');

const dataView = $id('mdDataView');
const summaryEl = $id('mdSummary');
const listEl = $id('mdList');
const eraseBtn = $id('mdEraseBtn');
const eraseMsg = $id('mdEraseMsg');
const confirmBox = $id('mdConfirm');
const confirmYes = $id('mdConfirmYes');
const confirmNo = $id('mdConfirmNo');
const doneEl = $id('mdDone');

const API = '/api/leads/my-data';

function show(el) {
  if (el) el.hidden = false;
}
function hide(el) {
  if (el) el.hidden = true;
}

/** Reveal the request form (no token, or an expired/invalid one). */
function showRequestForm(message) {
  hide(loadingEl);
  hide(dataView);
  show(requestForm);
  if (message) {
    requestMsg.textContent = message;
    requestMsg.classList.remove('is-ok');
  }
}

// --- Request a fresh link -------------------------------------------------

requestForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const addr = (emailInput.value || '').trim();
  requestMsg.classList.remove('is-ok');
  if (!addr || !addr.includes('@')) {
    requestMsg.textContent = 'Enter a valid email address.';
    return;
  }
  requestSubmit.disabled = true;
  requestMsg.textContent = 'Sending…';
  try {
    const resp = await fetch(`${API}/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: addr }),
    });
    if (resp.ok) {
      // Deliberately non-committal: the server never reveals whether the
      // address is on file, so neither do we.
      requestMsg.textContent =
        'If that address is on file, a link is on its way. Check your inbox.';
      requestMsg.classList.add('is-ok');
    } else if (resp.status === 429) {
      requestMsg.textContent = 'Too many requests. Please try again later.';
    } else if (resp.status === 501) {
      requestMsg.textContent =
        'This site is not configured to send email, so self-service is unavailable here.';
    } else {
      requestMsg.textContent = 'Something went wrong. Please try again.';
    }
  } catch {
    requestMsg.textContent = 'Network error. Please try again.';
  } finally {
    requestSubmit.disabled = false;
  }
});

// --- Render the data ------------------------------------------------------

function renderData(data) {
  hide(loadingEl);
  const count = Number(data.leadCount) || 0;

  summaryEl.textContent = count
    ? `${count} record${count === 1 ? '' : 's'} on file for ${data.email}.`
    : `No records are on file for ${data.email}.`;

  listEl.replaceChildren();
  for (const lead of data.leads || []) {
    const date = formatDate(lead.submittedAt);
    listEl.appendChild(
      h('li', { class: 'md-item' }, [
        h('div', {
          class: 'md-item-title',
          text: lead.name || data.email || '(record)',
        }),
        h('div', {
          class: 'md-item-meta',
          text: date ? `Submitted ${date}` : 'Submitted',
        }),
      ]),
    );
  }

  // Nothing to erase when there are no records: keep the button out of the way.
  eraseBtn.hidden = count === 0;
  show(dataView);
}

async function loadData() {
  show(loadingEl);
  try {
    const resp = await fetch(
      `${API}?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`,
    );
    if (resp.ok) {
      renderData(await resp.json());
    } else if (resp.status === 401) {
      showRequestForm(
        'That link is invalid or has expired. Request a new one below.',
      );
    } else if (resp.status === 429) {
      showRequestForm('Too many requests. Please try again in a few minutes.');
    } else {
      showRequestForm(
        'Something went wrong loading your data. Request a new link below.',
      );
    }
  } catch {
    showRequestForm('Network error. Request a new link below.');
  }
}

// --- Erase (confirmed) ----------------------------------------------------

eraseBtn?.addEventListener('click', () => {
  eraseMsg.textContent = '';
  show(confirmBox);
  eraseBtn.hidden = true;
});

confirmNo?.addEventListener('click', () => {
  hide(confirmBox);
  eraseBtn.hidden = false;
});

confirmYes?.addEventListener('click', async () => {
  confirmYes.disabled = true;
  confirmNo.disabled = true;
  eraseMsg.classList.remove('is-ok');
  eraseMsg.textContent = 'Erasing…';
  try {
    const resp = await fetch(
      `${API}?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`,
      { method: 'DELETE' },
    );
    if (resp.ok) {
      hide(dataView);
      doneEl.textContent =
        'Done. Your name and email have been removed from every record for this address.';
      doneEl.classList.add('is-ok');
      show(doneEl);
    } else if (resp.status === 401) {
      // The link expired between viewing and erasing, or was already spent.
      eraseMsg.textContent =
        'That link has expired. Request a fresh one to erase your data.';
    } else if (resp.status === 429) {
      eraseMsg.textContent =
        'Too many requests. Please try again in a few minutes.';
      confirmYes.disabled = false;
      confirmNo.disabled = false;
    } else {
      eraseMsg.textContent = 'Something went wrong. Please try again.';
      confirmYes.disabled = false;
      confirmNo.disabled = false;
    }
  } catch {
    eraseMsg.textContent = 'Network error. Please try again.';
    confirmYes.disabled = false;
    confirmNo.disabled = false;
  }
});

// --- Boot -----------------------------------------------------------------

if (email && token) {
  loadData();
} else {
  showRequestForm();
  if (email) emailInput.value = email;
}
