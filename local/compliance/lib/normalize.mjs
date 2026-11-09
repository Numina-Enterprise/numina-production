// Name normalization for sanctions screening: transliteration, Unicode folding,
// punctuation, honorifics, company suffixes, particles and word order.

const CYRILLIC = {
  а:'a',б:'b',в:'v',г:'g',ґ:'g',д:'d',е:'e',ё:'e',є:'ye',ж:'zh',з:'z',и:'i',і:'i',ї:'yi',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ў:'u',ф:'f',х:'kh',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya',ђ:'dj',ј:'j',љ:'lj',њ:'nj',ћ:'c',џ:'dz',ѓ:'gj',ќ:'kj',ѕ:'dz',қ:'k',ғ:'g',ү:'u',ұ:'u',ң:'n',һ:'h',ө:'o',ә:'a'
};
const GREEK = {
  α:'a',β:'v',γ:'g',δ:'d',ε:'e',ζ:'z',η:'i',θ:'th',ι:'i',κ:'k',λ:'l',μ:'m',ν:'n',ξ:'x',ο:'o',π:'p',ρ:'r',σ:'s',ς:'s',τ:'t',υ:'y',φ:'f',χ:'ch',ψ:'ps',ω:'o'
};
// Basic Arabic and Persian letters to a simple Latin skeleton (screening aid, not a scholarly romanization).
const ARABIC = {
  'ا':'a','أ':'a','إ':'i','آ':'a','ب':'b','پ':'p','ت':'t','ث':'th','ج':'j','چ':'ch','ح':'h','خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z','ژ':'zh','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'','غ':'gh','ف':'f','ق':'q','ک':'k','ك':'k','گ':'g','ل':'l','م':'m','ن':'n','ه':'h','ة':'a','و':'w','ؤ':'w','ي':'y','ی':'y','ى':'a','ئ':'y','ء':''
};
// Hebrew consonant skeleton.
const HEBREW = {'א':'a','ב':'b','ג':'g','ד':'d','ה':'h','ו':'v','ז':'z','ח':'kh','ט':'t','י':'y','כ':'k','ך':'k','ל':'l','מ':'m','ם':'m','נ':'n','ן':'n','ס':'s','ע':'','פ':'p','ף':'f','צ':'ts','ץ':'ts','ק':'k','ר':'r','ש':'sh','ת':'t'};
// Latin letters that NFKD does not decompose.
const LATIN_SPECIAL = {ß:'ss',ẞ:'ss',æ:'ae',Æ:'ae',œ:'oe',Œ:'oe',ø:'o',Ø:'o',đ:'d',Đ:'d',ð:'d',Ð:'d',þ:'th',Þ:'th',ł:'l',Ł:'l',ı:'i',ħ:'h',Ħ:'h',ŋ:'ng',ĸ:'k',ſ:'s'};

const MAPS = [CYRILLIC, GREEK, ARABIC, HEBREW];

export const HONORIFICS = new Set([
  'mr','mrs','ms','miss','mx','dr','prof','professor','sir','dame','rev','reverend','fr','father','sr','jr','ii','iii','iv',
  'esq','phd','md','hon','honorable','gen','general','col','colonel','maj','major','capt','captain','lt','sgt','adm','admiral','brig','cmdr',
  'sheikh','shaikh','sheik','shaykh','haji','hajji','hadji','mullah','mulla','maulana','mawlana','imam','ayatollah','hojatoleslam','emir','amir','excellency','herr','frau','senor','sra','sr','monsieur','mme','mlle','sig','signor','signora','dott','ing','mgr','engr'
]);

// Legal-form suffixes and generic organisation words (compared as whole tokens after punctuation removal).
export const COMPANY_SUFFIXES = new Set([
  'llc','l','lc','ltd','limited','inc','incorporated','corp','corporation','co','company','plc','llp','lp','pllc','pc','gmbh','mbh','ag','kg','ohg','ug','sa','sas','sarl','sl','slu','sas','srl','spa','sapa','snc','bv','nv','vof','oy','oyj','ab','as','asa','aps','a/s','kk','kabushiki','kaisha','yk','pte','pty','bhd','sdn','tbk','pt','jsc','ojsc','cjsc','pjsc','pao','oao','zao','ooo','tov','pp','fze','fzco','fzc','fzllc','dmcc','wll','spc','saog','saoc','est','establishment','trading','holding','holdings','group','enterprise','enterprises','international','intl','the','dba'
]);

// Name particles that are frequently added, dropped or spelled differently across transliterations.
export const PARTICLES = new Set(['al','el','ul','bin','ibn','ben','bint','abu','abou','abd','van','von','der','den','de','del','della','di','da','du','la','le','dos','das','y','e','of','and','for']);

export function transliterate(input) {
  let out = '';
  for (const ch of String(input ?? '')) {
    const lower = ch.toLowerCase();
    if (LATIN_SPECIAL[ch] !== undefined) { out += LATIN_SPECIAL[ch]; continue; }
    let mapped;
    for (const m of MAPS) if (m[lower] !== undefined) { mapped = m[lower]; break; }
    if (mapped === undefined) {
      // Accented Greek/Cyrillic letters (e.g. "έ") map via their base letter; "й" stays explicit above.
      const base = lower.normalize('NFD')[0];
      if (base !== lower) for (const m of MAPS) if (m[base] !== undefined) { mapped = m[base]; break; }
    }
    out += mapped !== undefined ? mapped : ch;
  }
  return out;
}

/** Unicode fold: transliterate, NFKD, strip combining marks, lowercase. */
export function fold(input) {
  return transliterate(String(input ?? '').normalize('NFKC'))
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();
}

/** Tokens after folding and punctuation removal (apostrophes join, other punctuation splits). */
export function tokenize(input) {
  return fold(input)
    .replace(/&/g, ' and ')
    .replace(/['’`ʼʻ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** "LAST, First Middle" (OFAC style) -> "First Middle LAST" before tokenizing. */
export function reorderCommaName(name) {
  const s = String(name ?? '');
  const parts = s.split(',');
  if (parts.length === 2 && parts[0].trim() && parts[1].trim() && !/\b(ltd|inc|llc|co|s\.?a)\b/i.test(parts[1])) return `${parts[1].trim()} ${parts[0].trim()}`;
  return s;
}

/** Join runs of 2+ single-letter tokens into one acronym token: "O N C U" -> "oncu". */
export function mergeInitialRuns(tokens) {
  const out = [];
  let run = [];
  const flush = () => { if (run.length >= 2) out.push(run.join('')); else out.push(...run); run = []; };
  for (const t of tokens) { if (t.length === 1 && /\p{L}/u.test(t)) run.push(t); else { flush(); out.push(t); } }
  flush();
  return out;
}

/**
 * Normalize a name for comparison.
 * @returns {{tokens:string[], core:string[], key:string, coreKey:string, joined:string}}
 *  tokens: significant tokens (honorifics/suffixes removed) in original order
 *  core: tokens with particles also removed
 *  key / coreKey: sorted, space-joined (word-order independent)
 *  joined: tokens without spaces (catches "AlQaida" vs "Al Qaida")
 */
export function normalizeName(name, {type} = {}) {
  let tokens = mergeInitialRuns(tokenize(reorderCommaName(name)));
  tokens = tokens.filter((t) => !HONORIFICS.has(t) || tokens.length === 1);
  if (type !== 'individual') {
    const stripped = tokens.filter((t) => !COMPANY_SUFFIXES.has(t));
    if (stripped.length) tokens = stripped;
  }
  const coreTokens = tokens.filter((t) => !PARTICLES.has(t));
  const core = coreTokens.length ? coreTokens : tokens;
  return {
    tokens,
    core,
    key: [...tokens].sort().join(' '),
    coreKey: [...core].sort().join(' '),
    joined: tokens.join(''),
  };
}
