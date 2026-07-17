import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  calculateReconnectDelayMs,
  classifyWhatsappRuntimeError,
  cleanupStaleChromiumLocks,
  createReconnectAudit,
  isTransientWhatsappState,
  recordPersistenceBoot,
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
assert.equal(isTransientWhatsappState('opening'), true);
assert.equal(isTransientWhatsappState('PAIRING'), true);
assert.equal(isTransientWhatsappState('CONNECTED'), false);

const persistenceMarker = path.join(authPath, '.persistence.json');
const firstBootEvidence = recordPersistenceBoot(persistenceMarker, {
  currentBootAt: '2026-07-17T20:00:00.000Z',
  processId: 1,
});
assert.equal(firstBootEvidence.status, 'writable_awaiting_restart');
const secondBootEvidence = recordPersistenceBoot(persistenceMarker, {
  currentBootAt: '2026-07-17T20:01:00.000Z',
  processId: 2,
});
assert.equal(secondBootEvidence.status, 'verified_across_restart');
assert.equal(secondBootEvidence.previousBootAt, '2026-07-17T20:00:00.000Z');
assert.equal(
  JSON.parse(fs.readFileSync(persistenceMarker, 'utf8')).firstSeenAt,
  '2026-07-17T20:00:00.000Z'
);

let auditNow = Date.parse('2026-07-17T20:00:00.000Z');
const reconnectAudit = createReconnectAudit({}, () => auditNow);
const firstAttempt = reconnectAudit.start('functional_health_process_restart');
assert.equal(reconnectAudit.snapshot().reconnectAttemptCount, 1);
assert.equal(firstAttempt.authReset, false);
reconnectAudit.start('auth_failure_restart', { authReset: true });
assert.equal(reconnectAudit.snapshot().pendingReconnectAttempt.authReset, true);
auditNow += 45_000;
const verified = reconnectAudit.completeVerified('active_network');
assert.equal(verified.outcome, 'verified');
assert.equal(verified.durationMs, 45_000);
assert.equal(reconnectAudit.snapshot().reconnectVerifiedCount, 1);

auditNow += 1_000;
reconnectAudit.start('disconnected_restart');
auditNow += 2_000;
assert.equal(reconnectAudit.completeFailed('pairing_required').outcome, 'failed');
assert.equal(reconnectAudit.snapshot().reconnectFailedCount, 1);
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
