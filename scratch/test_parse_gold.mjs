import assert from 'node:assert';
import { parseGoldAmount } from '../src/economy.js';

console.log('Testing parseGoldAmount updates...');

// Test 1: Plain number
assert.strictEqual(parseGoldAmount('10000'), 10000);

// Test 2: Period formatted number
assert.strictEqual(parseGoldAmount('100.000'), 100000);

// Test 3: K / k suffix
assert.strictEqual(parseGoldAmount('10k'), 10000);
assert.strictEqual(parseGoldAmount('10K'), 10000);
assert.strictEqual(parseGoldAmount('25k'), 25000);
assert.strictEqual(parseGoldAmount('2.5k'), 2500);
assert.strictEqual(parseGoldAmount('1m'), 1000000);

// Test 4: Full command string with !apostar prefix
assert.strictEqual(parseGoldAmount('!apostar 10000'), 10000);
assert.strictEqual(parseGoldAmount('!apostar 10K'), 10000);
assert.strictEqual(parseGoldAmount('!apostar 100.000'), 100000);
assert.strictEqual(parseGoldAmount('!apostar 1 50k'), 50000);
assert.strictEqual(parseGoldAmount('!apostar A 25.000'), 25000);

console.log('✅ ALL parseGoldAmount TESTS PASSED PERFECTLY!');
