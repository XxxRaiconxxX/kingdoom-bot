import assert from 'node:assert/strict';
import { createAccessCode, hashAccessCode } from './src/accessCodeUtils.js';

const code = createAccessCode();
assert.match(code, /^\d{6}$/);
assert.equal(hashAccessCode(code), hashAccessCode(code));
assert.notEqual(hashAccessCode(code), hashAccessCode('000000'));
console.log('ACCESS_CODES_OK');
