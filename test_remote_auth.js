import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ResilientRemoteAuth,
  VersionedFileRemoteAuthStore,
} from './src/remoteAuth.js';

const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'kingdoom-remote-auth-'));
const cachePath = path.join(rootPath, 'cache');
const storePath = path.join(rootPath, 'store');
const events = [];
const store = new VersionedFileRemoteAuthStore({
  localDataPath: cachePath,
  storePath,
  keepSnapshots: 3,
  onEvent: (event, payload) => events.push({ event, payload }),
});

function createAuth() {
  const auth = new ResilientRemoteAuth({
    clientId: 'kingdoom-bot',
    dataPath: cachePath,
    store,
    backupSyncIntervalMs: 60_000,
  });
  auth.setup({ options: { puppeteer: {} }, emit() {} });
  return auth;
}

const auth = createAuth();
await auth.beforeBrowserInitialized();
const localStoragePath = path.join(auth.userDataDir, 'Default', 'Local Storage');
const indexedDbPath = path.join(auth.userDataDir, 'Default', 'IndexedDB');
fs.mkdirSync(localStoragePath, { recursive: true });
fs.mkdirSync(indexedDbPath, { recursive: true });
const sessionTokenPath = path.join(localStoragePath, 'session-token.txt');

fs.writeFileSync(sessionTokenPath, 'snapshot-one');
assert.equal(
  await auth.forceBackup(),
  false,
  'A shutdown must not certify a first snapshot before the RemoteAuth stability delay.'
);
assert.equal(await auth.safeStoreRemoteSession({ emit: true }), true);
assert.equal(await store.sessionExists({ session: auth.sessionName }), true);

fs.writeFileSync(sessionTokenPath, 'snapshot-two');
assert.equal(await auth.forceBackup(), true);
const manifestPath = path.join(storePath, auth.sessionName, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.snapshots.length, 2);

await auth.disconnect();
assert.equal(fs.existsSync(auth.userDataDir), false);
assert.equal(
  await store.sessionExists({ session: auth.sessionName }),
  true,
  'A transient disconnect must preserve the remote session.'
);

const newestSnapshotPath = path.join(
  storePath,
  auth.sessionName,
  'snapshots',
  manifest.snapshots[0].file
);
fs.writeFileSync(newestSnapshotPath, 'corrupt');

const restoredAuth = createAuth();
await restoredAuth.beforeBrowserInitialized();
assert.equal(
  fs.readFileSync(
    path.join(restoredAuth.userDataDir, 'Default', 'Local Storage', 'session-token.txt'),
    'utf8'
  ),
  'snapshot-one'
);
assert.equal(
  events.some(({ event, payload }) => event === 'restored' && payload.usedFallback === true),
  true,
  'A corrupt latest snapshot must fall back to the previous verified version.'
);

await restoredAuth.logout();
assert.equal(await store.sessionExists({ session: restoredAuth.sessionName }), false);
assert.equal(fs.existsSync(restoredAuth.userDataDir), false);
assert.equal(events.some(({ event }) => event === 'deleted'), true);

fs.rmSync(rootPath, { recursive: true, force: true });
console.log('REMOTE_AUTH_OK');
