import crypto from 'node:crypto';

export function newSessionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

export function nowState() {
  return {
    updatedAt: Date.now(),
    stepIdx: 0,
    stepParagraphs: false,
    slideType: '',
  };
}
