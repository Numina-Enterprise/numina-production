// String similarity: Jaro-Winkler, Levenshtein ratio and a soft token-set score.

export function jaro(a, b) {
  if (a === b) return a.length ? 1 : 0;
  const la = a.length, lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array(la).fill(false), mb = new Array(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, lb);
    for (let j = lo; j < hi; j++) if (!mb[j] && a[i] === b[j]) { ma[i] = mb[j] = true; matches++; break; }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < la; i++) if (ma[i]) { while (!mb[k]) k++; if (a[i] !== b[k]) t++; k++; }
  return (matches / la + matches / lb + (matches - t / 2) / matches) / 3;
}

export function jaroWinkler(a, b, p = 0.1) {
  const j = jaro(a, b);
  let l = 0;
  while (l < 4 && l < a.length && l < b.length && a[l] === b[l]) l++;
  return j + l * p * (1 - j);
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({length: b.length + 1}, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
export const levenshteinRatio = (a, b) => (!a.length && !b.length ? 1 : 1 - levenshtein(a, b) / Math.max(a.length, b.length));

export const TOKEN_FLOOR = 0.75;

function tokenSim(s, d) {
  if (s === d) return 1;
  if (s.length === 1 || d.length === 1) return s[0] === d[0] ? 0.9 : 0; // initial vs full token
  const v = jaroWinkler(s, d);
  return v < TOKEN_FLOOR ? 0 : v;
}

function directional(src, dst) {
  let total = 0, weight = 0;
  for (const s of src) {
    let best = 0;
    for (const d of dst) { const v = tokenSim(s, d); if (v > best) best = v; }
    const w = Math.max(s.length, 2);
    total += best * w; weight += w;
  }
  return weight ? total / weight : 0;
}

/**
 * Soft token-set similarity, order independent. Each token is matched to its best counterpart with
 * Jaro-Winkler (pairs below TOKEN_FLOOR count as unmatched). The better-covered direction is weighted 0.75
 * so a missing middle name / patronymic still reaches review, while unrelated extra tokens pull the score down.
 * Initials match a token with the same first letter at 0.9 credit, only when the name also has a real token.
 */
export function tokenSetSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const realA = aTokens.some((t) => t.length >= 3), realB = bTokens.some((t) => t.length >= 3);
  if (!realA || !realB) return aTokens.join('') === bTokens.join('') ? 1 : 0;
  const x = directional(aTokens, bTokens), y = directional(bTokens, aTokens);
  return 0.75 * Math.max(x, y) + 0.25 * Math.min(x, y);
}
