import { $ } from './lib/dom.js';

// Ensure DOMPurify is available globally for the shared sanitize module.
// DOMPurify is loaded via script tag in index.html before this module runs.
if (typeof window !== 'undefined' && window.DOMPurify) {
  globalThis.DOMPurify = window.DOMPurify;
}

import {
  route,
  nav,
  setRenderer,
  startRouter,
} from './lib/state/router.js';
import { meWithMeta } from './lib/user/auth.js';
import { setFeatures } from './lib/state/features.js';
import { setDocumentTitle } from './lib/theme/branding.js';
import { renderList } from './views/list.js';
import { renderEditor } from './views/editor.js';
import { renderPresenter } from './views/presenter.js';
import { renderPresentWindow } from './views/present-window.js';
import { renderLogin } from './views/login.js';
import { renderForgotPassword } from './views/forgot-password.js';
import { renderResetPassword } from './views/reset-password.js';
import { renderMagicLogin } from './views/magic-login.js';
import { renderNotes } from './views/notes.js';
import { renderNotesJoin } from './views/notes-join.js';
import { renderFollow } from './views/follow.js';
import { renderModerate } from './views/moderate.js';
import { renderShareViewer } from './views/share-viewer.js';
import { renderSettings } from './views/settings.js';
import { renderAnalytics } from './views/analytics/index.js';
import { renderSharedReport } from './views/analytics/shared-report.js';
import { renderDashboard } from './views/analytics/dashboard.js';
import { initUiMode } from './lib/theme/ui-mode.js';
import { fetchAppSettings, fetchMySettings } from './lib/net/settings.js';
import { setSupportedLangs, writeLangMode } from './lib/format/i18n.js';
import { getUiLocale, readUiLocale, setUiLocale, t } from './lib/ui-i18n.js';
import { escapeHtml } from '../shared/slide-types/helpers.js';
import { showEditorLoadingSkeleton } from './views/editor/loading-skeleton.js';

let cachedMe = null;
let cachedMeAt = 0;
let cleanup = null;
let renderGen = 0;

async function getMeCached() {
  const now = Date.now();
  // Avoid spamming /me on every rerender; 10s is plenty.
  if (cachedMe && now - cachedMeAt < 10_000)
    return cachedMe;
  const { user, features } = await meWithMeta();
  setFeatures(features);
  cachedMe = user;
  cachedMeAt = now;
  return user;
}

function renderFatal(root, err) {
  const msgRaw = String(err?.message || err);
  const msg = escapeHtml(msgRaw);
  const stackRaw =
    typeof err?.stack === 'string' && err.stack.trim()
      ? err.stack
      : '';
  const details = escapeHtml(stackRaw || msgRaw);
  try {
    // eslint-disable-next-line no-console
    console.error('[fatal]', err);
  } catch {
    // ignore
  }
  root.innerHTML = `
    <div class="app-shell">
      <div class="panel" style="max-width:820px; margin: 60px auto;">
        <h2>${escapeHtml(t('app.fatal.title', 'Something went wrong'))}</h2>
        <div class="help">
          ${escapeHtml(
            t(
              'app.fatal.help',
              'The app hit an error while loading. If you just enabled authentication, verify your server `.env` has `AUTH_SECRET` and `AUTH_ADMIN_EMAIL` set.'
            )
          )}
        </div>
        <pre style="white-space:pre-wrap; overflow:auto; padding:12px; border-radius:12px; background:rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.12);">${details}</pre>
      </div>
    </div>
  `;
}

async function render() {
  const myGen = ++renderGen;
  const r = route();
  const root = $('#app');

  // Route-level page layout toggles (CSS-driven).
  // Keep these here so they always get reset correctly, even if a view throws.
  document.documentElement.classList.toggle('is-editor', r.name === 'edit');

  // Baseline browser-tab title (app name). Views that own a document — the
  // editor and presenter — override this with the deck title once it loads.
  setDocumentTitle();

  // Unmount previous view (important for global key handlers like the presenter).
  if (typeof cleanup === 'function') {
    try {
      cleanup();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('Cleanup failed', e);
    }
  }
  cleanup = null;

  root.innerHTML = '';

  // The editor route fetches auth/settings/presentation before it can mount;
  // show its layout skeleton right away so the page never sits blank.
  // renderEditor reuses (and removes) this instance.
  if (r.name === 'edit') {
    try {
      showEditorLoadingSkeleton(root);
    } catch {
      // purely cosmetic; never block rendering on it
    }
  }

  try {
    if (r.name === 'login') {
      cleanup = (await renderLogin(root, { nav })) || null;
      return;
    }

    if (r.name === 'forgotPassword') {
      cleanup = (await renderForgotPassword(root, { nav })) || null;
      return;
    }

    if (r.name === 'resetPassword') {
      cleanup = (await renderResetPassword(root, { nav })) || null;
      return;
    }

    if (r.name === 'magicLogin') {
      cleanup = (await renderMagicLogin(root, { nav })) || null;
      return;
    }

    // Public routes (no auth)
    if (r.name === 'follow') {
      cleanup =
        (await renderFollow(root, r.presentationId, { nav })) || null;
      return;
    }

    if (r.name === 'share') {
      cleanup =
        (await renderShareViewer(root, r.token, { nav })) || null;
      return;
    }

    if (r.name === 'report') {
      cleanup =
        (await renderSharedReport(root, r.token)) || null;
      return;
    }

    const user = await getMeCached();
    if (!user) {
      const returnTo = `${location.pathname}${
        location.search || ''
      }`;
      return nav(
        `/login?returnTo=${encodeURIComponent(returnTo)}`
      );
    }

    // Re-apply the baseline title now that branding config has loaded, so
    // authenticated app pages reflect a configured (white-label) app name.
    setDocumentTitle();

    // Bootstrap settings once we're authenticated:
    // - app-wide supported slide languages (also drives language-mode UI)
    // - per-user default language mode
    try {
      const appSettings = await fetchAppSettings();
      if (Array.isArray(appSettings?.supportedSlideLangs))
        setSupportedLangs(appSettings.supportedSlideLangs);
      const mySettings = await fetchMySettings();
      if (
        typeof mySettings?.uiLocale === 'string' &&
        mySettings.uiLocale !== getUiLocale()
      )
        await setUiLocale(mySettings.uiLocale);
      if (typeof mySettings?.uiLang === 'string')
        writeLangMode(mySettings.uiLang);
    } catch {
      // ignore; settings are non-critical for app boot
    }

    // If a newer render was triggered (e.g., by ui-locale-changed during
    // setUiLocale above), this render is stale — bail out so the newer
    // render can take over without us clobbering its DOM.
    if (myGen !== renderGen) return;

    if (r.name === 'list') {
      cleanup =
        (await renderList(root, { nav, user })) || null;
      return;
    }
    if (r.name === 'slideLibrary') {
      cleanup =
        (await renderList(root, {
          nav,
          user,
          openSlideLibrary: { scope: r.scope, slideId: r.slideId },
        })) || null;
      return;
    }
    if (r.name === 'settings') {
      cleanup =
        (await renderSettings(root, { nav, user })) || null;
      return;
    }
    if (r.name === 'insights') {
      cleanup =
        (await renderDashboard(root, { nav, user })) || null;
      return;
    }
    if (r.name === 'edit') {
      cleanup =
        (await renderEditor(root, r.id, { nav, user })) ||
        null;
      return;
    }
    if (r.name === 'present') {
      cleanup =
        (await renderPresenter(root, r.id, {
          nav,
          user,
        })) || null;
      return;
    }
    if (r.name === 'presentWindow') {
      cleanup =
        (await renderPresentWindow(root, r.id, {
          nav,
          user,
        })) || null;
      return;
    }
    if (r.name === 'notes') {
      cleanup =
        (await renderNotes(root, r.sessionId, {
          nav,
          user,
        })) || null;
      return;
    }
    if (r.name === 'notesJoin') {
      cleanup =
        (await renderNotesJoin(root, r.sessionId, {
          nav,
          user,
        })) || null;
      return;
    }
    if (r.name === 'moderate') {
      cleanup =
        (await renderModerate(root, r.presentationId, {
          nav,
          user,
        })) || null;
      return;
    }
    if (r.name === 'analytics') {
      cleanup =
        (await renderAnalytics(root, r.presentationId, {
          nav,
          user,
        })) || null;
      return;
    }
  } catch (err) {
    if (myGen !== renderGen) return;
    renderFatal(root, err);
  }
}

// Initialize UI mode as early as possible (bootstrap script in index.html prevents FOUC).
async function bootstrap() {
  initUiMode();
  try {
    await setUiLocale(readUiLocale(), { persist: false });
  } catch {
    // ignore
  }
  setRenderer(render);
  startRouter();
  // Re-render current route when UI locale changes (no full page reload needed).
  let rerenderQueued = false;
  window.addEventListener('ui-locale-changed', () => {
    if (rerenderQueued) return;
    rerenderQueued = true;
    queueMicrotask(() => {
      rerenderQueued = false;
      render();
    });
  });
  render();
}

bootstrap();