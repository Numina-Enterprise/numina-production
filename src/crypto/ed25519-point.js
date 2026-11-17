// RFC 8032 Ed25519 compressed-point recovery; inspection only, not signature verification.
export const P = (1n << 255n) - 19n;
const mod = n => ((n % P) + P) % P;
function pow(base, exponent) {
  let value = 1n;
  for (base = mod(base); exponent > 0n; exponent >>= 1n, base = mod(base * base)) {
    if (exponent & 1n) value = mod(value * base);
  }
  return value;
}
const inverse = n => {
  if (mod(n) === 0n) throw new Error("Invalid Edwards denominator");
  return pow(n, P - 2n);
};
const D = mod(-121665n * inverse(121666n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

export function recoverEd25519(y, sign, onCandidates = () => {}) {
  if (typeof y !== "bigint" || y < 0n || y >= P) throw new Error("Non-canonical y coordinate");
  if (sign !== 0 && sign !== 1) throw new Error("Invalid sign bit");
  const y2 = mod(y * y);
  const x2 = mod((y2 - 1n) * inverse(D * y2 + 1n));
  const x0 = pow(x2, (P + 3n) / 8n);
  const x1 = mod(x0 * SQRT_M1);
  const valid0 = mod(x0 * x0) === x2;
  const valid1 = mod(x1 * x1) === x2;
  onCandidates({
    x0: { value: x0, valid: valid0 },
    x1: { value: x1, valid: valid1 },
    rejected: !valid0 && !valid1
  });
  if (!valid0 && !valid1) throw new Error("Non-residue: both candidates rejected");
  let x = valid0 ? x0 : x1;
  if (x === 0n && sign === 1) throw new Error("Invalid sign bit for x = 0");
  const parityFixed = Number(x & 1n) !== sign;
  if (parityFixed) x = mod(-x);
  return { x, y, parityFixed };
}

export function decodeCompressedEd25519(bytes, onCandidates) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 32) {
    throw new Error("Compressed Ed25519 point must be 32 bytes");
  }
  const sign = bytes[31] >>> 7;
  let y = 0n;
  for (let i = 31; i >= 0; i--) {
    y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  }
  return recoverEd25519(y, sign, onCandidates);
}
