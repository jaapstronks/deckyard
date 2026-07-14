export function applyCapabilitiesToStage({ capabilities, slideWrap, interactionWrap } = {}) {
  const caps = capabilities && typeof capabilities === 'object' ? capabilities : null;
  // Ensure stage mode is consistent immediately.
  if (interactionWrap) interactionWrap.style.display = caps?.interaction ? '' : 'none';
  if (slideWrap) slideWrap.style.display = caps?.interaction ? 'none' : '';
}

export function showFollowMessage({
  h,
  slideWrap,
  interactionWrap,
  cleanupSlideRuntimes,
  msg,
} = {}) {
  cleanupSlideRuntimes?.(slideWrap);
  if (slideWrap) slideWrap.innerHTML = '';
  if (interactionWrap) interactionWrap.style.display = 'none';
  if (slideWrap) slideWrap.style.display = '';
  // Render a "muted slide" placeholder so the follow stage keeps the familiar 16:9 look.
  slideWrap?.append(
    h('div', { class: 'slide follow-message-slide' }, [
      h('div', { class: 'slide-inner' }, [
        h('div', { class: 'follow-message-box', text: msg }),
      ]),
    ])
  );
}
