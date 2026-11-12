// Fiat/USDC micro-unit parsing (6 decimals). This scale is for bank, CAMT, and USDC-style
// amounts only. It is NOT the NUSD scale: the deployed NUSD token
// (0x491c1DF1b5CA77AF797f052c2310ca17039C931b on chain 962421430) uses 18 decimals.
// Use the NUSD helpers below for any NUSD amount.
export const DECIMALS = 6n;
export const UNIT_SCALE = 10n ** DECIMALS;

/** Decimals of the deployed NUSD token (source of truth: runtime/nusd/mint-receipt.json). */
export const NUSD_DECIMALS = 18n;
export const NUSD_UNIT_SCALE = 10n ** NUSD_DECIMALS;
/** Decimals of USDC. */
export const USDC_DECIMALS = 6n;
export const USDC_UNIT_SCALE = 10n ** USDC_DECIMALS;
/** NUSD base units per USDC base unit for 1:1 whole-unit parity (1e12). */
export const NUSD_PER_USDC_BASE_UNIT = 10n ** (NUSD_DECIMALS - USDC_DECIMALS);
export const NUSD_TOKEN = Object.freeze({
  symbol: 'NUSD',
  decimals: Number(NUSD_DECIMALS),
  tokenAddress: '0x491c1DF1b5CA77AF797f052c2310ca17039C931b',
  chainId: '962421430'
});
export const MAX_UINT256 = 2n ** 256n - 1n;

const MONEY_RE = /^(?:0|[1-9]\d*)(?:\.(\d{1,6}))?$/;
const INTEGER_RE = /^(?:0|[1-9]\d*)$/;

function parseDecimalText(value, decimals) {
  if (typeof value !== 'string') throw new Error('MONEY_STRING_REQUIRED');
  const places = Number(decimals);
  const match = value.match(new RegExp(`^(0|[1-9]\\d*)(?:\\.(\\d{1,${places}}))?$`));
  if (!match) throw new Error('INVALID_MONETARY_VALUE');
  const units = BigInt(match[1]) * 10n ** decimals + BigInt((match[2] || '').padEnd(places, '0') || '0');
  if (units > MAX_UINT256) throw new Error('AMOUNT_EXCEEDS_UINT256');
  return units;
}

function formatUnits(units, decimals) {
  const value = parseMinorUnits(units);
  const scale = 10n ** decimals;
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(Number(decimals), '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Parse a base-10 monetary string (6-decimal micro units) without using floating-point arithmetic. */
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

/** Parse NUSD decimal text (at most 18 fractional digits) to 18-decimal base units. Never rounds. */
export function parseNusdToBaseUnits(value) {
  return parseDecimalText(value, NUSD_DECIMALS);
}

/** Parse USDC decimal text (at most 6 fractional digits) to 6-decimal base units. Never rounds. */
export function parseUsdcToBaseUnits(value) {
  return parseDecimalText(value, USDC_DECIMALS);
}

/** Format 18-decimal NUSD base units as exact decimal text. */
export function formatNusdBaseUnits(units) {
  return formatUnits(units, NUSD_DECIMALS);
}

/** Format 6-decimal USDC base units as exact decimal text. */
export function formatUsdcBaseUnits(units) {
  return formatUnits(units, USDC_DECIMALS);
}

/**
 * Convert NUSD base units (18 decimals) to USDC base units (6 decimals) at 1:1 whole-unit parity.
 * Amounts that are not an exact multiple of 1e12 are rejected rather than rounded.
 */
export function nusdToUsdcBaseUnits(nusdBaseUnits) {
  const value = parseMinorUnits(nusdBaseUnits);
  if (value > MAX_UINT256) throw new Error('AMOUNT_EXCEEDS_UINT256');
  if (value % NUSD_PER_USDC_BASE_UNIT !== 0n) throw new Error('NUSD_AMOUNT_NOT_DIVISIBLE_BY_1E12');
  return value / NUSD_PER_USDC_BASE_UNIT;
}

/** Convert USDC base units (6 decimals) to NUSD base units (18 decimals) at 1:1 whole-unit parity. */
export function usdcToNusdBaseUnits(usdcBaseUnits) {
  const value = parseMinorUnits(usdcBaseUnits) * NUSD_PER_USDC_BASE_UNIT;
  if (value > MAX_UINT256) throw new Error('AMOUNT_EXCEEDS_UINT256');
  return value;
}

/** Build a self-describing NUSD amount record: base units as a decimal string plus decimals, token, and chain. */
export function nusdAmount(baseUnits) {
  const value = parseMinorUnits(baseUnits);
  if (value > MAX_UINT256) throw new Error('AMOUNT_EXCEEDS_UINT256');
  return Object.freeze({
    baseUnits: value.toString(),
    decimals: NUSD_TOKEN.decimals,
    tokenAddress: NUSD_TOKEN.tokenAddress,
    chainId: NUSD_TOKEN.chainId
  });
}
