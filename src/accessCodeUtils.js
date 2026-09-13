import { createHash, randomInt } from 'node:crypto';

export function createAccessCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function hashAccessCode(code) {
  return createHash('sha256').update(String(code)).digest('hex');
}
