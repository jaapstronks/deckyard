import { createEditorController } from './editor-controller.js';
import { api } from '../../lib/api.js';
import { t } from '../../lib/ui-i18n.js';
import { createPageUnavailable } from '../../lib/dom/page-unavailable.js';
import { showEditorLoadingSkeleton } from './loading-skeleton.js';
import { nav } from '../../lib/state/router.js';
import { deckLangQuery } from '../../lib/format/i18n.js';

export async function renderEditor(root, id, { user } = {}) {
  // Long decks take a while to fetch + mount; show the layout skeleton
  // immediately so the page never sits blank (removed on every exit path).
  const hideSkeleton = showEditorLoadingSkeleton(root);

  // Fetch presentation to check permission level
  const langParam = deckLangQuery();

  let pres;
  try {
    pres = await api(`/api/presentations/${id}${langParam}`);
  } catch (err) {
    hideSkeleton();
    // Handle permission denied errors with a nice page
    if (err.statusCode === 401 || err.statusCode === 403) {
      renderPermissionDenied(root);
      return () => {};
    }
    // Handle not found
    if (err.statusCode === 404) {
      renderNotFound(root);
      return () => {};
    }
    // Re-throw other errors to be handled by the app shell
    throw err;
  }

  const permission = pres?._userPermission || 'edit';

  // For view or comment permissions, render the viewer mode instead of the editor
  if (permission === 'view' || permission === 'comment') {
    try {
      const { createViewerController } =
        await import('../viewer/viewer-controller.js');
      const controller = await createViewerController({
        root,
        id,
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
function renderPermissionDenied(root) {
  root.append(
    createPageUnavailable({
      icon: 'lock',
      title: t('access.denied.title', 'Access Denied'),
      message: t(
        'access.denied.message',
        "You don't have permission to view this presentation. If you believe you should have access, please contact the presentation owner to request access.",
      ),
      actionLabel: t('access.denied.backToHome', 'Back to Home'),
      onAction: () => nav('/app'),
    }),
  );
}

/**
 * Render a not found page.
 */
function renderNotFound(root) {
  root.append(
    createPageUnavailable({
      icon: 'search',
      title: t('access.notFound.title', 'Presentation Not Found'),
      message: t(
        'access.notFound.message',
        "This presentation doesn't exist or may have been deleted. Please check the link and try again.",
      ),
      actionLabel: t('access.notFound.backToHome', 'Back to Home'),
      onAction: () => nav('/app'),
    }),
  );
}
