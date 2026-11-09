import './helpers/no-network.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {fold, tokenize, normalizeName, transliterate, reorderCommaName, mergeInitialRuns} from '../../local/compliance/lib/normalize.mjs';
import {jaro, jaroWinkler, levenshtein, levenshteinRatio, tokenSetSimilarity} from '../../local/compliance/lib/similarity.mjs';
import {parseCsv, parseCsvObjects, toCsv} from '../../local/compliance/lib/csv.mjs';
import {ISO_ALPHA2, isCountryCode, countryCodeFromText, textMentionsCountry} from '../../local/compliance/lib/countries.mjs';

test('Unicode folding strips diacritics and special Latin letters', () => {
  assert.equal(fold('Jörg Müller'), 'jorg muller');
  assert.equal(fold('Łukasz Øster Straße'), 'lukasz oster strasse');
  assert.equal(fold('ＦＵＬＬＷＩＤＴＨ'), 'fullwidth');
});

test('transliteration covers Cyrillic, Greek, Arabic and Hebrew', () => {
  assert.equal(transliterate('Иван Фейкман'), 'ivan feykman');
  assert.equal(fold('Щукин'), 'shchukin');
  assert.equal(fold('Αλέξανδρος'), 'alexandros');
  assert.match(fold('محمد'), /^m.*d$/);
  assert.equal(fold('דוד'), 'dvd');
});

test('punctuation, apostrophes and ampersands', () => {
  assert.deepEqual(tokenize("AL QA'IDA"), ['al', 'qaida']);
  assert.deepEqual(tokenize('Smith & Sons, Ltd.'), ['smith', 'and', 'sons', 'ltd']);
  assert.deepEqual(tokenize('O\u2019Neil-Fake'), ['oneil', 'fake']);
});

test('OFAC "LAST, First" order is normalized and word order does not matter', () => {
  assert.equal(reorderCommaName('FAKEMAN, Ivan Testovich'), 'Ivan Testovich FAKEMAN');
  assert.equal(normalizeName('FAKEMAN, Ivan').key, normalizeName('Ivan Fakeman').key);
  assert.equal(normalizeName('Fakeman Ivan').key, normalizeName('Ivan Fakeman').key);
});

test('honorifics are removed', () => {
  assert.equal(normalizeName('Dr. Ivan Fakeman', {type: 'individual'}).key, normalizeName('Ivan Fakeman').key);
  assert.equal(normalizeName('Sheikh Abu Testah Al-Fakiri').coreKey, normalizeName('Testah Fakiri').coreKey);
  assert.equal(normalizeName('Mr').tokens.length, 1, 'a lone honorific is kept rather than emptying the name');
});

test('company suffixes are removed for entities, kept for individuals', () => {
  for (const n of ['Zzfake Trading Co., Ltd.', 'ZZFAKE TRADING LLC', 'Zzfake Trading GmbH', 'ZZFAKE TRADING OOO', 'zzfake trading s.a.']) assert.equal(normalizeName(n).key, 'zzfake', n);
  assert.deepEqual(normalizeName('Ltd Fakeperson', {type: 'individual'}).tokens, ['ltd', 'fakeperson']);
});

test('name particles are dropped in the core key and initials are merged', () => {
  assert.equal(normalizeName('Abd al Fakir bin Testah').coreKey, normalizeName('Fakir Testah').coreKey);
  assert.deepEqual(mergeInitialRuns(['o', 'n', 'c', 'u', 'trading']), ['oncu', 'trading']);
  assert.deepEqual(mergeInitialRuns(['john', 'q', 'public']), ['john', 'q', 'public']);
});

test('Jaro, Jaro-Winkler and Levenshtein reference values', () => {
  assert.equal(jaro('', ''), 0);
  assert.ok(Math.abs(jaro('martha', 'marhta') - 0.9444) < 0.001);
  assert.ok(Math.abs(jaroWinkler('martha', 'marhta') - 0.9611) < 0.001);
  assert.ok(Math.abs(jaroWinkler('dixon', 'dicksonx') - 0.8133) < 0.001);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshteinRatio('abc', 'abc'), 1);
});

test('token-set similarity is order independent, tolerates a missing middle name, and rejects unrelated names', () => {
  assert.equal(tokenSetSimilarity(['ivan', 'fakeman'], ['fakeman', 'ivan']), 1);
  const subset = tokenSetSimilarity(['ivan', 'fakeman'], ['ivan', 'testovich', 'fakeman']);
  assert.ok(subset >= 0.85 && subset < 1, `subset ${subset}`);
  assert.ok(tokenSetSimilarity(['john', 'placeholder'], ['ivan', 'fakeman']) < 0.5);
  assert.ok(tokenSetSimilarity(['p'], ['placeholder']) === 0, 'initial-only names need an exact match');
  assert.ok(tokenSetSimilarity(['j', 'fakeman'], ['john', 'fakeman']) > 0.9);
});

test('CSV parser handles quotes, commas, newlines, BOM and the OFAC EOF marker', () => {
  const rows = parseCsv('\uFEFF1,"A, B","say ""hi""","multi\nline"\r\n2,-0- ,x,y\r\n\x1a');
  assert.deepEqual(rows, [['1', 'A, B', 'say "hi"', 'multi\nline'], ['2', '-0- ', 'x', 'y']]);
  assert.deepEqual(parseCsvObjects('a,b\n1,2\n'), [{a: '1', b: '2'}]);
  assert.equal(toCsv([['x,y', 'z']]), '"x,y",z\n');
});

test('ISO 3166-1 alpha-2 list and OFAC country text mapping', () => {
  assert.equal(ISO_ALPHA2.size, 249);
  assert.ok(isCountryCode('US') && isCountryCode('kp') === true && !isCountryCode('XX') && !isCountryCode('USA'));
  assert.equal(countryCodeFromText('Korea, North'), 'KP');
  assert.equal(countryCodeFromText('Russia'), 'RU');
  assert.equal(countryCodeFromText('Palestinian'), 'PS');
  assert.equal(countryCodeFromText('Atlantis'), null);
  assert.ok(textMentionsCountry('Testgrad, Russia', 'RU'));
});
