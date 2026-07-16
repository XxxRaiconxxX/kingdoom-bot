import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sanitizeLogText } from './src/logSanitizer.js';

const sanitized = sanitizeLogText(
  'chat=595123456789@g.us sender=231408626888802@lid key=nvapi-secretvalue token?token=hf_secretvalue ip=192.168.0.1'
);
assert.equal(sanitized.includes('595123456789'), false);
assert.equal(sanitized.includes('231408626888802'), false);
assert.equal(sanitized.includes('nvapi-secretvalue'), false);
assert.equal(sanitized.includes('hf_secretvalue'), false);
assert.equal(sanitized.includes('192.168.0.1'), false);
assert.match(sanitized, /\[redacted-jid\]/);
assert.match(sanitized, /\[redacted-secret\]/);

const aiSource = fs.readFileSync(new URL('./src/ai.js', import.meta.url), 'utf8');
assert.equal(
  /key\.substring|key\.slice/.test(aiSource),
  false,
  'AI logs must never expose a raw API-key prefix.'
);

console.log('LOG_SANITIZER_OK');
