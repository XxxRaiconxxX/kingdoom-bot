const PLAIN_GOLD_PATTERN = /^(?:0|[1-9]\d*)$/;
const GROUPED_GOLD_PATTERN = /^(?:[1-9]\d{0,2})(?:\.\d{3})+$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export function parseGoldAmount(value, { allowZero = false } = {}) {
  const token = String(value ?? '').trim();
  if (!PLAIN_GOLD_PATTERN.test(token) && !GROUPED_GOLD_PATTERN.test(token)) {
    return null;
  }

  const amount = Number(token.replace(/\./g, ''));
  if (
    !Number.isSafeInteger(amount)
    || amount < 0
    || amount > POSTGRES_INTEGER_MAX
    || (!allowZero && amount === 0)
  ) {
    return null;
  }

  return amount;
}

export function requireSafeGoldInteger(value, { allowZero = false, allowNegative = false } = {}) {
  const amount = Number(value);
  const minimum = allowNegative ? -POSTGRES_INTEGER_MAX : (allowZero ? 0 : 1);
  if (
    !Number.isSafeInteger(amount)
    || amount < minimum
    || amount > POSTGRES_INTEGER_MAX
    || (!allowZero && amount === 0)
  ) {
    throw new TypeError('La cantidad de oro no es un entero seguro permitido.');
  }
  return amount;
}
