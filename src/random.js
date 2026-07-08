import crypto from 'crypto';

export function secureRandomFloat() {
  return crypto.randomInt(0, 100000000) / 100000000;
}

export function secureRandomInt(min, max) {
  if (min >= max) return min;
  return crypto.randomInt(Math.ceil(min), Math.floor(max) + 1);
}
