export async function meWithMeta() {
  const res = await fetch('/api/auth/me', { headers: { 'Content-Type': 'application/json' } });
  if (res.status === 401) return { user: null, features: null };
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  const body = await res.json();
  return {
    user: body?.user || null,
    features: body?.features || null,
  };
}

// Back-compat convenience: most call sites only need the user.
export async function me() {
  const { user } = await meWithMeta();
  return user || null;
}

export async function login(email, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `Login failed (${res.status})`;
    try {
      const data = JSON.parse(text);
      message = data.details || data.message || data.error || message;
    } catch {
      if (text) message = text;
    }
    throw new Error(message);
  }
  const body = await res.json();
  return body?.user || null;
}

export async function logout() {
  const res = await fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error((await res.text()) || `Logout failed (${res.status})`);
  return true;
}
