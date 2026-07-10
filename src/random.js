import { randomInt, randomBytes } from 'crypto';

/**
 * Returns a cryptographically secure random integer between min (inclusive) and max (inclusive).
 */
export function secureRandomInt(min, max) {
  if (min > max) {
    [min, max] = [max, min];
  }
  return randomInt(min, max + 1);
}

/**
 * Returns a cryptographically secure random float between 0 (inclusive) and 1 (exclusive).
 */
export function secureRandomFloat() {
  const maxUint32 = 0xFFFFFFFF;
  return randomBytes(4).readUInt32LE(0) / (maxUint32 + 1);
}
