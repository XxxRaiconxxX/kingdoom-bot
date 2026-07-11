import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');

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

function runWatchdogScenario({ ready, qrAgeMs }) {
  const callbacks = [];
  const exits = [];
  const events = [];
  const now = Date.now();
  const context = {
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    WHATSAPP_CONNECT_STALL_TIMEOUT_MS: 150000,
    whatsappClientReady: ready,
    latestQrDataUrl: qrAgeMs === null ? '' : 'data:image/png;base64,test',
    latestQrUpdatedAt: qrAgeMs === null ? null : new Date(now - qrAgeMs).toISOString(),
    latestPairingCode: '',
    latestPairingCodeUpdatedAt: null,
    lastWhatsappProgressAt: now - 200000,
    recordRuntimeEvent: (...args) => events.push(args),
    process: { exit: (code) => exits.push(code) },
    setInterval: (callback) => {
      callbacks.push(callback);
      return { unref() {} };
    },
    Math,
    Number,
  };

  vm.runInNewContext(`${watchdogSource}\nstartWhatsappConnectWatchdog();`, context);
  callbacks[0]();
  return { exits, events };
}

assert.equal(runWatchdogScenario({ ready: true, qrAgeMs: null }).exits.length, 0);
assert.equal(runWatchdogScenario({ ready: false, qrAgeMs: 1000 }).exits.length, 0);

const staleQr = runWatchdogScenario({ ready: false, qrAgeMs: 200000 });
assert.deepEqual(staleQr.exits, [1]);
assert.equal(staleQr.events[0][0], 'connect_watchdog_restart');
assert.match(staleQr.events[0][1], /QR vencido sin progreso/);

console.log('CONNECTION_WATCHDOG_OK');
