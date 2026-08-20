import { api } from '../api.js';

export async function meWithMeta() {
  try {
    const body = await api('/api/auth/me');
    return {
      user: body?.user || null,
      features: body?.features || null,
    };
  } catch (err) {
    // Signed out is a state, not a failure — and the one place a 401 must
    // not become a toast: the router redirects to /login on a null user.
    if (err?.statusCode === 401) return { user: null, features: null };
    throw err;
  }
}

// Back-compat convenience: most call sites only need the user.
export async function me() {
  const { user } = await meWithMeta();
  return user || null;
}

export async function login(email, password) {
  const body = await api('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  return body?.user || null;
}

export async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  return true;
}
