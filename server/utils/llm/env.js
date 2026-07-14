export function requireEnv(name) {
  const v = process.env[name];
  if (typeof v !== 'string' || !v.trim()) {
    const err = new Error(`Missing ${name} in environment (.env).`);
    err.statusCode = 400;
    throw err;
  }
  return v.trim();
}

export function optionalEnv(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
