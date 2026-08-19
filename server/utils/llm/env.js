import { envStr } from '../../config/utils.js';
import { ValidationError } from '../errors.js';

export function requireEnv(name) {
  const v = envStr(name);
  if (!v) {
    throw new ValidationError(`Missing ${name} in environment (.env).`);
  }
  return v;
}

export function optionalEnv(name) {
  return envStr(name) || null;
}
