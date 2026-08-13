import { envStr } from '../../config/utils.js';

export function requireEnv(name) {
  const v = envStr(name);
  if (!v) {
    const err = new Error(`Missing ${name} in environment (.env).`);
    err.statusCode = 400;
    throw err;
  }
  return v;
}

export function optionalEnv(name) {
  return envStr(name) || null;
}

