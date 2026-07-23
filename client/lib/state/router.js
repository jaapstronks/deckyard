let renderFn = () => {};

export function setRenderer(fn) {
  renderFn = fn;
}

export function startRouter() {
  window.addEventListener('popstate', () => renderFn());
}

export function nav(to) {
  let dest = String(to || '/');
  history.pushState(null, '', dest);
  renderFn();
}

export function route() {
  const url = new URL(location.href);
  const p = url.pathname;
  if (p === '/' || p === '/app') return { name: 'list' };
  if (p === '/login') return { name: 'login' };
  if (p === '/forgot-password') return { name: 'forgotPassword' };
  if (p === '/reset-password') return { name: 'resetPassword' };
  if (p === '/magic-login') return { name: 'magicLogin' };
  if (p === '/settings') return { name: 'settings' };
  if (p === '/insights') return { name: 'insights' };
  // Slide library permalink: /app/slide-library/:scope/:id
  const slm = p.match(/^\/app\/slide-library\/(team|personal)\/([^/]+)$/);
  if (slm) return { name: 'slideLibrary', scope: slm[1], slideId: slm[2] };
  const m = p.match(/^\/app\/([^/]+)$/);
  if (m) return { name: 'edit', id: m[1] };
  const pwm = p.match(/^\/present\/([^/]+)\/window$/);
  if (pwm) return { name: 'presentWindow', id: pwm[1] };
  const pm = p.match(/^\/present\/([^/]+)$/);
  if (pm) return { name: 'present', id: pm[1] };
  const nm = p.match(/^\/notes\/([^/]+)$/);
  if (nm) return { name: 'notes', sessionId: nm[1] };
  const jm = p.match(/^\/notes-join\/([^/]+)$/);
  if (jm) return { name: 'notesJoin', sessionId: jm[1] };
  const fm = p.match(/^\/follow\/([^/]+)$/);
  if (fm) return { name: 'follow', presentationId: fm[1] };
  const mm = p.match(/^\/moderate\/([^/]+)$/);
  if (mm) return { name: 'moderate', presentationId: mm[1] };
  const sm = p.match(/^\/s\/([^/]+)$/);
  if (sm) return { name: 'share', token: sm[1] };
  const am = p.match(/^\/analytics\/([^/]+)$/);
  if (am) return { name: 'analytics', presentationId: am[1] };
  const rm = p.match(/^\/reports\/([^/]+)$/);
  if (rm) return { name: 'report', token: rm[1] };
  return { name: 'list' };
}
