import { createEditorController } from './editor-controller.js';
import { api } from '../../lib/api.js';
import { h } from '../../lib/dom.js';
import { t } from '../../lib/ui-i18n.js';
import { iconUrl } from '../../../shared/icon-names.js';
import { showEditorLoadingSkeleton } from './loading-skeleton.js';

export async function renderEditor(
  root,
  id,
  { nav, user } = {}
) {
  // Long decks take a while to fetch + mount; show the layout skeleton
  // immediately so the page never sits blank (removed on every exit path).
  const hideSkeleton = showEditorLoadingSkeleton(root);

  // Fetch presentation to check permission level
  const url = new URL(location.href);
  const initialLang = url.searchParams.get('lang');
  const langParam =
    initialLang === 'nl' || initialLang === 'en-GB'
      ? `?lang=${encodeURIComponent(initialLang)}`
      : '';

  let pres;
  try {
    pres = await api(`/api/presentations/${id}${langParam}`);
  } catch (err) {
    hideSkeleton();
    // Handle permission denied errors with a nice page
    if (err.statusCode === 401 || err.statusCode === 403) {
      renderPermissionDenied(root, nav);
      return () => {};
    }
    // Handle not found
    if (err.statusCode === 404) {
      renderNotFound(root, nav);
      return () => {};
    }
    // Re-throw other errors to be handled by the app shell
    throw err;
  }

  const permission = pres?._userPermission || 'edit';

  // For view or comment permissions, render the viewer mode instead of the editor
  if (permission === 'view' || permission === 'comment') {
    try {
      const { createViewerController } = await import('../viewer/viewer-controller.js');
      const controller = await createViewerController({
        root,
        id,
        nav,
        user,
        permission,
        pres,
      });
      return controller.detach;
    } finally {
      hideSkeleton();
    }
  }

  // Default: full editor for 'edit' permission
  try {
    const controller = await createEditorController({
      root,
      id,
      nav,
      user,
      initialPres: pres,
    });
    return controller.detach;
  } finally {
    hideSkeleton();
  }
}

/**
 * Render a permission denied page.
 */
function renderPermissionDenied(root, nav) {
  const shell = h('div', { class: 'access-error-shell' });

  const card = h('div', { class: 'access-error-card' });

  const icon = h('img', { class: 'access-error-icon', src: iconUrl('lock'), alt: '', 'aria-hidden': 'true' });

  const title = h('h1', {
    class: 'access-error-title',
    text: t('access.denied.title', 'Access Denied'),
  });

  const message = h('p', {
    class: 'access-error-message',
    text: t(
      'access.denied.message',
      "You don't have permission to view this presentation. If you believe you should have access, please contact the presentation owner to request access."
    ),
  });

  const actions = h('div', { class: 'access-error-actions' });

  const backBtn = h('button', {
    class: 'btn btn-primary',
    text: t('access.denied.backToHome', 'Back to Home'),
    onclick: () => nav?.('/app'),
  });

  actions.append(backBtn);
  card.append(icon, title, message, actions);
  shell.append(card);
  root.append(shell);
}

/**
 * Render a not found page.
 */
function renderNotFound(root, nav) {
  const shell = h('div', { class: 'access-error-shell' });

  const card = h('div', { class: 'access-error-card' });

  const icon = h('img', { class: 'access-error-icon', src: iconUrl('search'), alt: '', 'aria-hidden': 'true' });

  const title = h('h1', {
    class: 'access-error-title',
    text: t('access.notFound.title', 'Presentation Not Found'),
  });

  const message = h('p', {
    class: 'access-error-message',
    text: t(
      'access.notFound.message',
      "This presentation doesn't exist or may have been deleted. Please check the link and try again."
    ),
  });

  const actions = h('div', { class: 'access-error-actions' });

  const backBtn = h('button', {
    class: 'btn btn-primary',
    text: t('access.notFound.backToHome', 'Back to Home'),
    onclick: () => nav?.('/app'),
  });

  actions.append(backBtn);
  card.append(icon, title, message, actions);
  shell.append(card);
  root.append(shell);
}
