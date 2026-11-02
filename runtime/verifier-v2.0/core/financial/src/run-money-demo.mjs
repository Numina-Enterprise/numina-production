import { parseMonetaryToUnits, parseMinorUnits, DECIMALS, UNIT_SCALE } from './money.mjs';

console.log('================================================================================');
console.log('NUMINA PRECISION MONEY MODULE: LIVE EXECUTION & TYPE AUDIT');
console.log('================================================================================');
console.log('Precision Scale:              ', DECIMALS.toString(), 'decimals');
console.log('Unit Multiplier:              ', UNIT_SCALE.toString(), 'n (1 USD = 1,000,000n)');
console.log('--------------------------------------------------------------------------------');

// Test standard monetary conversions
const samples = [
  '1.00',
  '123.45',
  '500000000.00',
  '1500000000000000.123456' // $1.5 Quadrillion with micro precision
];

console.log('[*] Testing parseMonetaryToUnits(string):');
for (const s of samples) {
  const units = parseMonetaryToUnits(s);
  console.log(`    $${s.padEnd(25)} => ${units.toString().padStart(24)}n micro-units`);
}

console.log('--------------------------------------------------------------------------------');
console.log('[*] Testing parseMinorUnits(bigint | integer):');
console.log('    1000000n                   =>', parseMinorUnits(1000000n).toString(), 'n');
console.log('    "400000000000000"          =>', parseMinorUnits('400000000000000').toString(), 'n');

console.log('--------------------------------------------------------------------------------');
console.log('[*] Testing Boundary & "None" / Null Fuzzing Guards:');

const invalidInputs = [null, undefined, 'None', 12.34, '1.1234567', '-50.00'];

for (const bad of invalidInputs) {
  try {
    parseMonetaryToUnits(bad);
    console.log(`    ✗ FAILED: Input ${bad} was not rejected`);
  } catch (err) {
    console.log(`    ✓ REJECTED [${String(bad).padEnd(10)}]: ${err.message}`);
  }
}

console.log('================================================================================');
console.log('MONEY AUDIT COMPLETE: Pure BigInt arithmetic with zero float precision loss.');
console.log('================================================================================');
