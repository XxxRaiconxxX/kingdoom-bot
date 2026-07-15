import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  calculateReconnectDelayMs,
  classifyWhatsappRuntimeError,
  cleanupStaleChromiumLocks,
} from './src/whatsappRecovery.js';

const authPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kingdoom-auth-'));
const sessionPath = path.join(authPath, 'session');
fs.mkdirSync(sessionPath, { recursive: true });
fs.writeFileSync(path.join(sessionPath, 'SingletonLock'), 'stale');
fs.writeFileSync(path.join(sessionPath, 'DevToolsActivePort'), 'stale');
fs.writeFileSync(path.join(sessionPath, 'Preferences'), 'keep');

const removed = cleanupStaleChromiumLocks(authPath);
assert.deepEqual(removed.sort(), ['DevToolsActivePort', 'SingletonLock']);
assert.equal(fs.existsSync(path.join(sessionPath, 'SingletonLock')), false);
assert.equal(fs.existsSync(path.join(sessionPath, 'Preferences')), true);
assert.equal(calculateReconnectDelayMs(1, 5000, 60000), 5000);
assert.equal(calculateReconnectDelayMs(4, 5000, 60000), 40000);
assert.equal(calculateReconnectDelayMs(8, 5000, 60000), 60000);
assert.deepEqual(
  classifyWhatsappRuntimeError(
    new Error('Protocol error (Runtime.callFunctionOn): Execution context was destroyed.')
  ),
  { transientContext: true, restartable: true }
);
assert.deepEqual(
  classifyWhatsappRuntimeError(new Error('Protocol error: Session closed.')),
  { transientContext: false, restartable: true }
);
assert.deepEqual(
  classifyWhatsappRuntimeError(new Error('ordinary handler failure')),
  { transientContext: false, restartable: false }
);

fs.rmSync(authPath, { recursive: true, force: true });
console.log('WHATSAPP_RECOVERY_OK');
