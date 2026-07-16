import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  WHATSAPP_HEALTH_STATE,
  chooseFunctionalRecoveryAction,
  createWhatsappHealthTracker,
} from './src/whatsappHealth.js';

const source = fs
  .readFileSync(new URL('./src/index.js', import.meta.url), 'utf8')
  .replace(/\r\n/g, '\n');

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `Missing source marker: ${endMarker}`);
  return source.slice(start, end);
}

const recordRuntimeEventSource = sourceBetween(
  'function recordRuntimeEvent(',
  'function renderStatusMetaHtml('
);
assert.equal(
  recordRuntimeEventSource.includes('markWhatsappProgress()'),
  false,
  'Generic runtime events must not keep the WhatsApp watchdog alive.'
);

for (const [startMarker, endMarker] of [
  ["client.on('qr'", "client.on('code'"],
  ["client.on('code'", "client.on('authenticated'"],
  ["client.on('authenticated'", "client.on('loading_screen'"],
  ["client.on('loading_screen'", "client.on('ready'"],
  ["client.on('ready'", "client.on('auth_failure'"],
]) {
  assert.equal(
    sourceBetween(startMarker, endMarker).includes('markWhatsappProgress()'),
    true,
    `${startMarker} must report real WhatsApp progress.`
  );
}

const authenticatedHandlerSource = sourceBetween(
  "client.on('authenticated'",
  "client.on('loading_screen'"
);
assert.ok(
  authenticatedHandlerSource.indexOf('authenticatedEventSeen') <
    authenticatedHandlerSource.indexOf('markWhatsappProgress()'),
  'Duplicate authenticated events must be ignored before extending the connection deadline.'
);

const readyHandlerSource = sourceBetween("client.on('ready'", "client.on('auth_failure'");
assert.ok(
  readyHandlerSource.indexOf('if (readyBootstrapComplete)') <
    readyHandlerSource.indexOf('whatsappClientReady = true'),
  'Duplicate ready events must not restore readiness.'
);
assert.ok(
  readyHandlerSource.indexOf("whatsappHealth.markConnected('ready_event')") <
    readyHandlerSource.indexOf('startScheduler(client, isWhatsappOperational)'),
  'ready must become unverified before automatic services are wired.'
);
assert.equal(
  readyHandlerSource.includes("'Conectado a WhatsApp.'"),
  false,
  'ready alone must not claim a healthy channel.'
);

const messageHandlerSource = sourceBetween(
  "client.on('message'",
  'async function initializeClientWithRetry()'
);
assert.ok(
  messageHandlerSource.indexOf('IGNORED_INTERNAL_MESSAGE_TYPES.has') <
    messageHandlerSource.indexOf('markWhatsappInbound(msg)'),
  'Internal encryption notifications must not certify functional health.'
);
assert.ok(
  messageHandlerSource.indexOf('markWhatsappInbound(msg)') <
    messageHandlerSource.indexOf('safeGetQuotedDetails(msg)'),
  'Real inbound traffic must certify the channel before command processing.'
);

const watchdogSource = sourceBetween(
  'function startWhatsappConnectWatchdog()',
  "recordRuntimeEvent(\n  'boot'"
);
assert.ok(watchdogSource.includes('probeWhatsappClient(client'));
assert.ok(watchdogSource.includes('getStalePageInboundSignal()'));
assert.ok(watchdogSource.includes('recoverFunctionalWhatsappHealth(probe)'));
assert.ok(watchdogSource.includes('hasFreshQr'));
assert.ok(watchdogSource.includes("'connect_watchdog_restart'"));
assert.equal(
  watchdogSource.includes("normalizedState === 'CONNECTED'"),
  false,
  'CONNECTED must not be the sole health decision.'
);

const operationalSource = sourceBetween(
  'function isWhatsappOperational()',
  'function applyWhatsappHealthStatus('
);
assert.ok(operationalSource.includes('whatsappHealth.isHealthy()'));
assert.ok(source.includes('startScheduler(client, isWhatsappOperational)'));
assert.ok(source.includes('startAuctionsRealtime(client, isWhatsappOperational)'));
assert.equal(source.includes("from 'qrcode-terminal'"), false, 'QR credentials must not be printed to logs.');
assert.equal(
  source.includes('WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE'),
  false,
  'Initialization failures must never erase a potentially valid session.'
);

for (const [startMarker, endMarker] of [
  ["client.on('auth_failure'", "client.on('disconnected'"],
  ["client.on('disconnected'", "client.on('change_state'"],
]) {
  const handlerSource = sourceBetween(startMarker, endMarker);
  assert.equal(handlerSource.includes('process.exit('), false);
  assert.equal(handlerSource.includes('requestProcessRestart('), true);
}

const clientOptionsSource = sourceBetween('const client = new Client({', "client.on('qr'");
assert.ok(clientOptionsSource.includes('takeoverOnConflict: WHATSAPP_TAKEOVER_ON_CONFLICT'));
assert.ok(clientOptionsSource.includes('takeoverTimeoutMs: WHATSAPP_TAKEOVER_TIMEOUT_MS'));

const changeStateSource = sourceBetween("client.on('change_state'", "client.on('message_create'");
assert.equal(
  changeStateSource.includes('markWhatsappProgress()'),
  false,
  'State oscillation alone must not hide a stalled connection.'
);

const recoverySource = sourceBetween(
  'async function recoverFunctionalWhatsappHealth(',
  'function startWhatsappConnectWatchdog()'
);
assert.ok(recoverySource.includes('client.attachEventListeners()'));
assert.equal(
  recoverySource.includes('client.inject()'),
  false,
  'Bridge repair must reattach the message listeners instead of repeating full injection.'
);

let now = 0;
const health = createWhatsappHealthTracker({
  now: () => now,
  stabilityWindowMs: 60_000,
  requiredProbeSuccesses: 3,
  failureLimit: 3,
});

assert.equal(health.markConnected().state, WHATSAPP_HEALTH_STATE.CONNECTED_UNVERIFIED);
assert.equal(health.isHealthy(), false);
for (const at of [0, 30_000, 60_000]) {
  now = at;
  health.recordProbe({ ok: true, socketState: 'CONNECTED', reason: 'probe_ok' });
}
assert.equal(health.isHealthy(), true, 'A stable active-probe window must enable delivery.');

now = 90_000;
assert.equal(
  health.recordProbe({
    ok: false,
    socketState: 'CONNECTED',
    reason: 'message_bridge_unavailable',
    error: 'bridge missing',
  }).state,
  WHATSAPP_HEALTH_STATE.DEGRADED
);
assert.equal(health.isHealthy(), false, 'One functional failure must pause automatic delivery.');

now = 95_000;
assert.equal(health.markInbound().state, WHATSAPP_HEALTH_STATE.HEALTHY);
assert.equal(health.snapshot().confidence, 'real_traffic');

for (let attempt = 0; attempt < 3; attempt += 1) {
  now += 1_000;
  health.recordProbe({ ok: false, socketState: 'CONNECTED', reason: 'active_probe_failed' });
}
assert.equal(health.hasReachedFailureLimit(), true);

assert.equal(
  chooseFunctionalRecoveryAction({ reattachAttempted: false, recoveryAttempts: 0 }),
  'reattach'
);
assert.equal(
  chooseFunctionalRecoveryAction({ reattachAttempted: true, recoveryAttempts: 0 }),
  'restart'
);
assert.equal(
  chooseFunctionalRecoveryAction({ reattachAttempted: true, recoveryAttempts: 1 }),
  'quarantine'
);
assert.equal(
  chooseFunctionalRecoveryAction({
    reattachAttempted: true,
    recoveryAttempts: 1,
    authInvalidated: true,
  }),
  'reset-auth'
);
assert.equal(
  chooseFunctionalRecoveryAction({ reattachAttempted: true, recoveryAttempts: 2 }),
  'quarantine'
);

const requestProcessRestartSource = sourceBetween(
  'function requestProcessRestart(',
  'async function shutdownForSignal('
);
const restartTimers = [];
const restartEvents = [];
const clearedAuthEvents = [];
const exitCodes = [];
const restartContext = {
  restartRequested: false,
  restartClearAuthRequested: false,
  restartClearAuthEvent: '',
  shutdownRequested: false,
  whatsappClientReady: true,
  whatsappHealth: { markUnavailable() {} },
  clearInboundHealthSignals() {},
  WHATSAPP_HEALTH_STATE,
  runtimeStatus: { restartCount: 0 },
  WHATSAPP_RESTART_GRACE_MS: 2500,
  recordRuntimeEvent: (...args) => restartEvents.push(args),
  closeWhatsappBrowser: async () => {},
  clearAuthDataPath: (event) => clearedAuthEvents.push(event),
  sleep: async () => {},
  formatInitializeError: (error) => error?.message ?? String(error),
  process: { exit: (code) => exitCodes.push(code) },
  setTimeout: (callback, delayMs) => {
    restartTimers.push({ callback, delayMs });
    return restartTimers.length;
  },
  Math,
  Number,
};
vm.runInNewContext(requestProcessRestartSource, restartContext);

assert.equal(
  restartContext.requestProcessRestart('functional_health_process_restart', 'bridge stalled'),
  true
);
assert.equal(
  restartContext.requestProcessRestart(
    'disconnected_restart',
    'WhatsApp disconnected: LOGOUT',
    { clearAuth: true }
  ),
  true
);
assert.equal(restartTimers.length, 1, 'Recovery escalation must not create a restart loop.');
assert.equal(restartContext.restartClearAuthRequested, true);
await restartTimers[0].callback();
assert.deepEqual(clearedAuthEvents, ['disconnected_restart']);
assert.deepEqual(exitCodes, [1]);

console.log('CONNECTION_WATCHDOG_OK');
