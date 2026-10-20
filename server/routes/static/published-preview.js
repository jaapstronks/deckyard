import path from 'node:path';
import { notFound, serveFile } from '../../utils/http.js';
import { getPublishedById } from '../../storage/published.js';
import { getPresentation } from '../../storage/presentations/index.js';
import { crossOrganizationScope } from '../../storage/scope.js';
import {
  safePublishedOgImage,
  isPublishedPreviewAssetName,
} from '../../render/og-image.js';

/** Serve generated local OG assets only while the publication still proves them safe. */
export async function handlePublishedPreview({
  repoRoot,
  res,
  url,
  sharedPublicDirs,
}) {
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  if (
    !pathname.startsWith('/uploads/') ||
    !isPublishedPreviewAssetName(path.basename(pathname))
  )
    return false;
  const match =
    /^\/uploads\/(og-v2-([a-f0-9]{8})-[a-f0-9]{20}-[a-f0-9-]+\.png)$/.exec(
      pathname,
    );
  if (!match) {
    notFound(res);
    return true;
  }
  const scope = crossOrganizationScope(
    repoRoot,
    'published-preview: public id authorizes current safe artifact',
  );
  const entry = await getPublishedById(scope, match[2]);
  const pres = entry?.presentationId
    ? await getPresentation(scope, entry.presentationId)
    : null;
  const uploadDir = sharedPublicDirs.find(
    (item) => item.urlPrefix === '/uploads/',
  )?.dir;
  if (
    !pres ||
    !uploadDir ||
    entry.ogImageUrl !== pathname ||
    safePublishedOgImage(pres, pathname) !== pathname
  ) {
    notFound(res);
    return true;
  }
  await serveFile(res, path.join(uploadDir, match[1]), { userUpload: true });
  return true;
}
