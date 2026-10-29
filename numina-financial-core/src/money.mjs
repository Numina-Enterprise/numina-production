export const DECIMALS = 6n;
export const UNIT_SCALE = 10n ** DECIMALS;

const MONEY_RE = /^(?:0|[1-9]\d*)(?:\.(\d{1,6}))?$/;
const INTEGER_RE = /^(?:0|[1-9]\d*)$/;

/** Parse a base-10 monetary string without using floating-point arithmetic. */
export function parseMonetaryToUnits(value) {
  if (typeof value !== 'string') {
    throw new Error('MONEY_STRING_REQUIRED');
  }
  const match = value.match(MONEY_RE);
  if (!match) throw new Error('INVALID_MONETARY_VALUE');
  const fraction = (match[1] || '').padEnd(Number(DECIMALS), '0');
  return BigInt(match[0].split('.')[0]) * UNIT_SCALE + BigInt(fraction || '0');
}

/** Parse integer minor units from a signed payload without coercion. */
export function parseMinorUnits(value) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error('NEGATIVE_MINOR_UNITS');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_MINOR_UNITS');
    return BigInt(value);
  }
  if (typeof value !== 'string' || !INTEGER_RE.test(value)) {
    throw new Error('INVALID_MINOR_UNITS');
  }
  return BigInt(value);
}
