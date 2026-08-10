const PLAIN_GOLD_PATTERN = /^(?:0|[1-9]\d*)$/;
const GROUPED_GOLD_PATTERN = /^(?:[1-9]\d{0,2})(?:\.\d{3})+$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export function parseGoldAmount(value, { allowZero = false } = {}) {
  if (value === null || value === undefined) return null;

  let token = String(value).trim();
  // Strip leading command if passed full message body e.g. "!apostar 10k" -> "10k"
  token = token.replace(/^!\w+\s*/i, '').trim();

  // If passed "A 10k" or "1 100.000", take the last token as gold amount
  const parts = token.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const firstPart = parts[0].toLowerCase();
    if (['1', '2', 'a', 'b', 'luchador1', 'luchador2', 'luchadora', 'luchadorb'].includes(firstPart)) {
      token = parts.slice(1).join(' ').trim();
    } else {
      token = parts[parts.length - 1].trim();
    }
  }

  if (!token) return null;

  // Handle k/K and m/M suffixes (e.g., 10k, 25.5k, 1m)
  const kMatch = token.match(/^([1-9]\d*(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kmKM])$/);
  if (kMatch) {
    const num = Number.parseFloat(kMatch[1]);
    const unit = kMatch[2].toLowerCase();
    const multiplier = unit === 'k' ? 1_000 : 1_000_000;
    const amount = Math.floor(num * multiplier);
    if (!Number.isSafeInteger(amount) || amount <= 0 || amount > POSTGRES_INTEGER_MAX) {
      return null;
    }
    return amount;
  }

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
