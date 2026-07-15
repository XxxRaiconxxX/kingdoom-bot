import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
  'Generic HTTP/runtime events must not keep the WhatsApp watchdog alive.'
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
  'Duplicate ready events must not restore readiness before client.getState confirms it.'
);

const messageHandlerSource = sourceBetween(
  "client.on('message'",
  'async function initializeClientWithRetry()'
);
assert.ok(
  messageHandlerSource.indexOf('IGNORED_INTERNAL_MESSAGE_TYPES.has') <
    messageHandlerSource.indexOf('safeGetQuotedDetails(msg)'),
  'Internal encryption notifications must be ignored before quoted-message resolution.'
);

for (const [startMarker, endMarker] of [
  ["client.on('auth_failure'", "client.on('disconnected'"],
  ["client.on('disconnected'", "client.on('change_state'"],
]) {
  const handlerSource = sourceBetween(startMarker, endMarker);
  assert.equal(
    handlerSource.includes('process.exit('),
    false,
    `${startMarker} must return control to whatsapp-web.js before process exit.`
  );
  assert.equal(
    handlerSource.includes('requestProcessRestart('),
    true,
    `${startMarker} must use the coordinated restart path.`
  );
}

const clientOptionsSource = sourceBetween('const client = new Client({', "client.on('qr'");
assert.equal(clientOptionsSource.includes('takeoverOnConflict: WHATSAPP_TAKEOVER_ON_CONFLICT'), true);
assert.equal(clientOptionsSource.includes('takeoverTimeoutMs: WHATSAPP_TAKEOVER_TIMEOUT_MS'), true);

assert.equal(
  sourceBetween("client.on('change_state'", "client.on('group_join'").includes(
    'markWhatsappProgress()'
  ),
  false,
  'State oscillation alone must not hide a stalled connection.'
);

const watchdogSource = sourceBetween(
  'function startWhatsappConnectWatchdog()',
  "recordRuntimeEvent(\n  'boot'"
);
async function runWatchdogScenario({
  ready,
  qrAgeMs,
  states = [],
  checks = 1,
  bootstrapComplete = ready,
}) {
  const callbacks = [];
  const restarts = [];
  const events = [];
  const persistedStatuses = [];
  const stateQueue = [...states];
  const now = Date.now();
  const context = {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    WHATSAPP_CONNECT_STALL_TIMEOUT_MS: 150000,
    WHATSAPP_READY_HEALTH_FAILURE_LIMIT: 3,
    WHATSAPP_READY_HEALTH_TIMEOUT_MS: 10000,
    whatsappClientReady: ready,
    readyBootstrapComplete: bootstrapComplete,
    whatsappStateCheckInFlight: false,
    lastWhatsappState: null,
    lastWhatsappStateCheckedAt: null,
    whatsappStateFailureCount: 0,
    whatsappStateCheckError: '',
    restartRequested: false,
    shutdownRequested: false,
    appStatus: '',
    latestQrDataUrl: qrAgeMs === null ? '' : 'data:image/png;base64,test',
    latestQrUpdatedAt: qrAgeMs === null ? null : new Date(now - qrAgeMs).toISOString(),
    latestPairingCode: '',
    latestPairingCodeUpdatedAt: null,
    lastWhatsappProgressAt: now - 200000,
    recordRuntimeEvent: (...args) => events.push(args),
    persistRuntimeStatus: () => persistedStatuses.push(true),
    formatInitializeError: (error) => error?.message ?? String(error),
    sleep: () => new Promise(() => {}),
    runtimeStatus: { restartCount: 0 },
    WHATSAPP_INIT_RETRY_DELAY_MS: 15000,
    WHATSAPP_RECONNECT_MAX_DELAY_MS: 60000,
    calculateReconnectDelayMs: () => 15000,
    requestProcessRestart: (...args) => {
      restarts.push(args);
      context.restartRequested = true;
    },
    client: {
      getState: async () => {
        const nextState = stateQueue.length > 0 ? stateQueue.shift() : 'CONNECTED';
        if (nextState instanceof Error) throw nextState;
        return nextState;
      },
    },
    setInterval: (callback) => {
      callbacks.push(callback);
      return { unref() {} };
    },
    Math,
    Number,
  };

  vm.runInNewContext(`${watchdogSource}\nstartWhatsappConnectWatchdog();`, context);
  for (let check = 0; check < checks; check += 1) {
    await callbacks[0]();
  }
  return { restarts, events, persistedStatuses, context };
}

const healthyReady = await runWatchdogScenario({ ready: true, qrAgeMs: null });
assert.equal(healthyReady.restarts.length, 0);
assert.equal(healthyReady.context.lastWhatsappState, 'CONNECTED');
assert.equal(healthyReady.context.whatsappStateFailureCount, 0);

assert.equal(
  (await runWatchdogScenario({ ready: false, qrAgeMs: 1000 })).restarts.length,
  0
);

const staleQr = await runWatchdogScenario({ ready: false, qrAgeMs: 200000 });
assert.equal(staleQr.restarts.length, 1);
assert.equal(staleQr.restarts[0][0], 'connect_watchdog_restart');
assert.match(staleQr.restarts[0][1], /QR vencido sin progreso/);

const ghostSession = await runWatchdogScenario({
  ready: true,
  qrAgeMs: null,
  states: ['UNPAIRED', 'UNPAIRED', 'UNPAIRED'],
  checks: 3,
});
assert.equal(ghostSession.restarts.length, 1);
assert.equal(ghostSession.restarts[0][0], 'ready_state_mismatch_restart');
assert.equal(ghostSession.restarts[0][2].clearAuth, true);
assert.equal(ghostSession.context.whatsappClientReady, false);
assert.equal(ghostSession.context.whatsappStateFailureCount, 3);

const stateCheckFailure = await runWatchdogScenario({
  ready: true,
  qrAgeMs: null,
  states: [new Error('page closed'), new Error('page closed'), new Error('page closed')],
  checks: 3,
});
assert.equal(stateCheckFailure.restarts.length, 1);
assert.equal(stateCheckFailure.restarts[0][0], 'ready_state_mismatch_restart');
assert.equal(stateCheckFailure.restarts[0][2].clearAuth, false);
assert.match(stateCheckFailure.restarts[0][1], /page closed/);

const recoveredState = await runWatchdogScenario({
  ready: true,
  qrAgeMs: null,
  states: ['OPENING', 'CONNECTED'],
  checks: 2,
});
assert.equal(recoveredState.restarts.length, 0);
assert.equal(recoveredState.context.whatsappClientReady, true);
assert.equal(recoveredState.context.whatsappStateFailureCount, 0);
assert.equal(
  recoveredState.events.some(([event]) => event === 'ready_state_recovered'),
  true
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
  restartContext.requestProcessRestart('unhandled_rejection_restart', 'context reset'),
  true
);
assert.equal(
  restartContext.requestProcessRestart(
    'disconnected_restart',
    'WhatsApp se desconecto con motivo: LOGOUT',
    { clearAuth: true }
  ),
  true
);
assert.equal(restartTimers.length, 1);
assert.equal(restartContext.runtimeStatus.restartCount, 1);
assert.equal(restartContext.restartClearAuthRequested, true);
assert.equal(
  restartEvents.some(([event]) => event === 'restart_auth_clear_escalated'),
  true
);

await restartTimers[0].callback();
assert.deepEqual(clearedAuthEvents, ['disconnected_restart']);
assert.deepEqual(exitCodes, [1]);

console.log('CONNECTION_WATCHDOG_OK');
