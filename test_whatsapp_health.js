import assert from 'node:assert/strict';
import fs from 'node:fs';
import { probeWhatsappClient } from './src/whatsappHealth.js';

const healthSource = fs.readFileSync(new URL('./src/whatsappHealth.js', import.meta.url), 'utf8');
assert.ok(
  healthSource.includes('if (!message?.isNewMsg) return;'),
  'The independent bridge monitor must ignore hydrated message history.'
);
assert.ok(
  healthSource.includes("message.once?.('change:type', signalInbound)"),
  'Encrypted messages must wait for decryption instead of triggering a false bridge failure.'
);
assert.ok(
  healthSource.includes("messages.off?.('add', currentMonitor.listener)"),
  'The independent observer must be reattached when WhatsApp resets listeners in place.'
);

function createProbeClient(overrides = {}) {
  let binding = null;
  const diagnostics = overrides.diagnostics ?? {
    socketState: 'CONNECTED',
    wwebjsReady: true,
    bridgeReady: true,
    probeBindingReady: true,
    collectionReady: true,
    monitorReady: true,
  };
  const page = {
    isClosed: () => false,
    exposeFunction: async (_name, callback) => {
      binding = callback;
    },
    evaluate: async (_fn, ...args) => {
      if (args.length === 1) return Boolean(binding);
      return diagnostics;
    },
  };

  return {
    client: {
      info: { wid: { user: '595000000000' } },
      pupPage: page,
      getState: async () => overrides.socketState ?? 'CONNECTED',
      sendPresenceAvailable: async () => {
        if (overrides.presenceError) throw overrides.presenceError;
      },
      getNumberId: async () => Object.hasOwn(overrides, 'numberId')
        ? overrides.numberId
        : { _serialized: 'self@c.us' },
    },
    getBinding: () => binding,
  };
}

const signals = [];
const healthy = createProbeClient();
const healthyResult = await probeWhatsappClient(healthy.client, {
  activeNetworkProbe: true,
  onPageInboundSignal: (id) => signals.push(id),
});
assert.equal(healthyResult.ok, true);
assert.equal(healthyResult.reason, 'active_network_probe_ok');
healthy.getBinding()('opaque-message-id');
assert.deepEqual(signals, ['opaque-message-id']);

const missingBridge = createProbeClient({
  diagnostics: {
    socketState: 'CONNECTED',
    wwebjsReady: true,
    bridgeReady: false,
    probeBindingReady: true,
    collectionReady: true,
    monitorReady: true,
  },
});
const bridgeResult = await probeWhatsappClient(missingBridge.client);
assert.equal(bridgeResult.ok, false);
assert.equal(bridgeResult.reason, 'message_bridge_unavailable');

const falseConnected = createProbeClient({ numberId: null });
const falseConnectedResult = await probeWhatsappClient(falseConnected.client, {
  activeNetworkProbe: true,
});
assert.equal(falseConnectedResult.ok, false);
assert.equal(falseConnectedResult.socketState, 'CONNECTED');
assert.equal(falseConnectedResult.reason, 'linked_account_not_confirmed');
assert.match(falseConnectedResult.error, /active network query/i);

const optionalPresence = createProbeClient({ presenceError: new Error('presence module unavailable') });
const optionalPresenceResult = await probeWhatsappClient(optionalPresence.client, {
  activeNetworkProbe: false,
});
assert.equal(optionalPresenceResult.ok, true);

const addListeners = new Set();
const messageCollection = {
  on(event, listener) {
    if (event === 'add') addListeners.add(listener);
  },
  off(event, listener) {
    if (event === 'add') addListeners.delete(listener);
  },
  emitAdd(message) {
    for (const listener of [...addListeners]) listener(message);
  },
};
const fakeWindow = {
  WWebJS: {},
  onAddMessageEvent() {},
  require(moduleName) {
    if (moduleName === 'WAWebSocketModel') return { Socket: { state: 'CONNECTED' } };
    if (moduleName === 'WAWebCollections') return { Msg: messageCollection };
    throw new Error(`Unexpected browser module: ${moduleName}`);
  },
};
function runInFakeWindow(callback) {
  const previousWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    return callback();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}
const executablePage = {
  isClosed: () => false,
  async exposeFunction(name, callback) {
    fakeWindow[name] = callback;
  },
  async evaluate(callback, ...args) {
    return runInFakeWindow(() => callback(...args));
  },
};
const bridgeSignals = [];
const executableClient = {
  info: { wid: { user: '595000000000' } },
  pupPage: executablePage,
  getState: async () => 'CONNECTED',
};
const probeOptions = {
  activePresenceProbe: false,
  activeNetworkProbe: false,
  onPageInboundSignal: (id) => bridgeSignals.push(id),
};
assert.equal((await probeWhatsappClient(executableClient, probeOptions)).ok, true);

runInFakeWindow(() => messageCollection.emitAdd({
  id: { _serialized: 'history-1', remote: { _serialized: 'chat@c.us' } },
  type: 'chat',
  isNewMsg: false,
}));
assert.deepEqual(bridgeSignals, []);

runInFakeWindow(() => messageCollection.emitAdd({
  id: { _serialized: 'new-1', remote: { _serialized: 'chat@c.us' } },
  type: 'chat',
  isNewMsg: true,
}));
assert.deepEqual(bridgeSignals, ['new-1']);

let onDecrypted = null;
const encryptedMessage = {
  id: { _serialized: 'encrypted-1', remote: { _serialized: 'chat@c.us' } },
  type: 'ciphertext',
  isNewMsg: true,
  once(event, callback) {
    if (event === 'change:type') onDecrypted = callback;
  },
};
runInFakeWindow(() => messageCollection.emitAdd(encryptedMessage));
assert.deepEqual(bridgeSignals, ['new-1']);
runInFakeWindow(() => onDecrypted({ ...encryptedMessage, type: 'chat' }));
assert.deepEqual(bridgeSignals, ['new-1', 'encrypted-1']);

assert.equal((await probeWhatsappClient(executableClient, probeOptions)).ok, true);
assert.equal(addListeners.size, 1);
runInFakeWindow(() => messageCollection.emitAdd({
  id: { _serialized: 'new-2', remote: { _serialized: 'chat@c.us' } },
  type: 'chat',
  isNewMsg: true,
}));
assert.deepEqual(bridgeSignals, ['new-1', 'encrypted-1', 'new-2']);

console.log('WHATSAPP_HEALTH_OK');
