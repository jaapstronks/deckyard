import crypto from 'node:crypto';

export function normalizeSlides(slides) {
  if (!Array.isArray(slides)) return [];
  return slides.map((s) => {
    const normalized = {
      ...s,
      id: typeof s?.id === 'string' && s.id ? s.id : crypto.randomUUID(),
      content:
        s?.type === 'poll-slide'
          ? {
              ...(s?.content && typeof s.content === 'object' ? s.content : {}),
              pollId:
                typeof s?.content?.pollId === 'string' && s.content.pollId.trim()
                  ? s.content.pollId.trim()
                  : crypto.randomUUID(),
            }
          : s?.content,
    };
    // Preserve parentId for nested slides (null = top-level)
    normalized.parentId =
      typeof s?.parentId === 'string' && s.parentId.trim()
        ? s.parentId.trim()
        : null;
    // Preserve author lock flag if present
    if (typeof s?.lockedByAuthor === 'boolean') {
      normalized.lockedByAuthor = s.lockedByAuthor;
    }
    // Preserve per-slide duration override if valid (1-300 seconds)
    if (typeof s?.duration === 'number' && s.duration >= 1 && s.duration <= 300) {
      normalized.duration = Math.round(s.duration);
    }
    // Preserve data source binding config if present
    if (s?.dataSource && typeof s.dataSource === 'object' && s.dataSource.provider) {
      normalized.dataSource = s.dataSource;
    }
    return normalized;
  });
}
