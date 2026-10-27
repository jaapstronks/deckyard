#ifndef DECKYARD_RENDER_FILTER_H
#define DECKYARD_RENDER_FILTER_H

/*
 * Development candidate, not an activated execution boundary. The caller must
 * already have the approved B1 namespaces/mounts/identity/FD inventory, and an
 * initial OCI filter that denies all io_uring operations before Node starts.
 * Returns only after a successful process-wide TSYNC. Every failure exits.
 */
void renderer_install_filter(void);

#endif
