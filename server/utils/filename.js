import crypto from 'node:crypto';

export function safeFilename(input) {
  const cleaned = String(input || '')
    .trim()
    .replace(/[^\w\- ]+/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 80);
  return cleaned || `presentation-${crypto.randomUUID().slice(0, 8)}`;
}
