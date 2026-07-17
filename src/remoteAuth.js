import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import pkg from 'whatsapp-web.js';

const { RemoteAuth } = pkg;
const requireFromWhatsappWeb = createRequire(createRequire(import.meta.url).resolve('whatsapp-web.js'));
const unzipper = requireFromWhatsappWeb('unzipper');

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

function safeSessionName(value) {
  const session = String(value ?? '').trim();
  if (!/^[-_\w]+$/i.test(session)) {
    throw new Error('Invalid remote auth session name');
  }
  return session;
}

function normalizeSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const file = path.basename(String(value.file ?? ''));
  const size = Number(value.size);
  const sha256 = String(value.sha256 ?? '');
  if (!file.endsWith('.zip') || !Number.isFinite(size) || size <= 0 || !/^[a-f0-9]{64}$/i.test(sha256)) {
    return null;
  }
  return {
    file,
    size,
    sha256: sha256.toLowerCase(),
    createdAt: String(value.createdAt ?? ''),
  };
}

export class VersionedFileRemoteAuthStore {
  constructor({ localDataPath, storePath, keepSnapshots = 3, onEvent = () => undefined }) {
    this.localDataPath = path.resolve(localDataPath);
    this.storePath = path.resolve(storePath);
    this.keepSnapshots = Math.max(2, Number.parseInt(String(keepSnapshots), 10) || 3);
    this.onEvent = onEvent;
    this.operation = Promise.resolve();
  }

  runExclusive(operation) {
    const result = this.operation.then(operation, operation);
    this.operation = result.catch(() => undefined);
    return result;
  }

  getSessionPaths(sessionValue) {
    const session = safeSessionName(sessionValue);
    const root = path.join(this.storePath, session);
    return {
      session,
      root,
      snapshots: path.join(root, 'snapshots'),
      manifest: path.join(root, 'manifest.json'),
      sourceArchive: path.join(this.localDataPath, `${session}.zip`),
    };
  }

  async readManifest(paths) {
    try {
      const parsed = JSON.parse(await fsPromises.readFile(paths.manifest, 'utf8'));
      return {
        version: 1,
        session: paths.session,
        snapshots: Array.isArray(parsed?.snapshots)
          ? parsed.snapshots.map(normalizeSnapshot).filter(Boolean)
          : [],
      };
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { version: 1, session: paths.session, snapshots: [] };
      }
      throw error;
    }
  }

  async writeManifest(paths, snapshots) {
    await fsPromises.mkdir(paths.root, { recursive: true });
    const temporaryPath = `${paths.manifest}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fsPromises.writeFile(temporaryPath, `${JSON.stringify({
        version: 1,
        session: paths.session,
        updatedAt: new Date().toISOString(),
        snapshots,
      }, null, 2)}\n`, 'utf8');
      await fsPromises.rename(temporaryPath, paths.manifest);
    } finally {
      await fsPromises.rm(temporaryPath, { force: true });
    }
  }

  async validateSnapshot(paths, snapshot) {
    const filePath = path.join(paths.snapshots, snapshot.file);
    try {
      const stats = await fsPromises.stat(filePath);
      if (!stats.isFile() || stats.size !== snapshot.size) return null;
      if ((await hashFile(filePath)) !== snapshot.sha256) return null;
      return filePath;
    } catch {
      return null;
    }
  }

  async findValidSnapshot(paths, manifest = null) {
    const currentManifest = manifest ?? await this.readManifest(paths);
    for (const [index, snapshot] of currentManifest.snapshots.entries()) {
      const filePath = await this.validateSnapshot(paths, snapshot);
      if (filePath) return { snapshot, filePath, index };
    }
    return null;
  }

  async sessionExists({ session }) {
    return this.runExclusive(async () => {
      const paths = this.getSessionPaths(session);
      return Boolean(await this.findValidSnapshot(paths));
    });
  }

  async save({ session }) {
    return this.runExclusive(async () => {
      const paths = this.getSessionPaths(session);
      const sourceStats = await fsPromises.stat(paths.sourceArchive);
      if (!sourceStats.isFile() || sourceStats.size <= 0) {
        throw new Error('Remote auth archive is empty');
      }

      const sha256 = await hashFile(paths.sourceArchive);
      const createdAt = new Date().toISOString();
      const file = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${sha256.slice(0, 12)}.zip`;
      const finalPath = path.join(paths.snapshots, file);
      const temporaryPath = `${finalPath}.${process.pid}.tmp`;
      await fsPromises.mkdir(paths.snapshots, { recursive: true });
      try {
        await fsPromises.copyFile(paths.sourceArchive, temporaryPath);
        const copiedStats = await fsPromises.stat(temporaryPath);
        const copiedHash = await hashFile(temporaryPath);
        if (copiedStats.size !== sourceStats.size || copiedHash !== sha256) {
          throw new Error('Remote auth snapshot verification failed after copy');
        }
        await fsPromises.rename(temporaryPath, finalPath);
      } finally {
        await fsPromises.rm(temporaryPath, { force: true });
      }

      const previousManifest = await this.readManifest(paths);
      const snapshot = { file, size: sourceStats.size, sha256, createdAt };
      const snapshots = [snapshot, ...previousManifest.snapshots]
        .filter((candidate, index, list) =>
          list.findIndex((entry) => entry.file === candidate.file) === index)
        .slice(0, this.keepSnapshots);
      try {
        await this.writeManifest(paths, snapshots);
      } catch (error) {
        await fsPromises.rm(finalPath, { force: true });
        throw error;
      }

      const retainedFiles = new Set(snapshots.map((candidate) => candidate.file));
      await Promise.allSettled(previousManifest.snapshots
        .filter((candidate) => !retainedFiles.has(candidate.file))
        .map((candidate) => fsPromises.rm(path.join(paths.snapshots, candidate.file), { force: true })));

      this.onEvent('saved', { session: paths.session, createdAt, size: sourceStats.size });
      return snapshot;
    });
  }

  async extract({ session, path: destinationPath }) {
    return this.runExclusive(async () => {
      const paths = this.getSessionPaths(session);
      const manifest = await this.readManifest(paths);
      const valid = await this.findValidSnapshot(paths, manifest);
      if (!valid) throw new Error('No valid remote auth snapshot is available');

      const destination = path.resolve(destinationPath);
      const temporaryPath = `${destination}.${process.pid}.tmp`;
      await fsPromises.mkdir(path.dirname(destination), { recursive: true });
      try {
        await fsPromises.copyFile(valid.filePath, temporaryPath);
        const copiedStats = await fsPromises.stat(temporaryPath);
        const copiedHash = await hashFile(temporaryPath);
        if (copiedStats.size !== valid.snapshot.size || copiedHash !== valid.snapshot.sha256) {
          throw new Error('Remote auth snapshot verification failed during restore');
        }
        await fsPromises.rm(destination, { force: true });
        await fsPromises.rename(temporaryPath, destination);
      } finally {
        await fsPromises.rm(temporaryPath, { force: true });
      }
      this.onEvent('restored', {
        session: paths.session,
        createdAt: valid.snapshot.createdAt,
        usedFallback: valid.index > 0,
      });
      return valid.snapshot;
    });
  }

  async delete({ session }) {
    return this.runExclusive(async () => {
      const paths = this.getSessionPaths(session);
      await fsPromises.rm(paths.root, { recursive: true, force: true });
      this.onEvent('deleted', { session: paths.session });
    });
  }
}

export class ResilientRemoteAuth extends RemoteAuth {
  constructor(options = {}) {
    super(options);
    this.onEvent = options.onEvent ?? (() => undefined);
    this.backupInFlight = null;
    this.stopped = false;
  }

  async beforeBrowserInitialized() {
    this.stopped = false;
    await super.beforeBrowserInitialized();
  }

  async unCompressSession(compressedSessionPath) {
    const extractor = unzipper.Extract({
      path: this.userDataDir,
      concurrency: 10,
    });
    await new Promise((resolve, reject) => {
      const input = fs.createReadStream(compressedSessionPath);
      input.once('error', reject);
      extractor.once('error', reject);
      extractor.once('close', resolve);
      input.pipe(extractor);
    });
    await fsPromises.unlink(compressedSessionPath);
  }

  async safeStoreRemoteSession({ emit = false } = {}) {
    if (this.stopped) return false;
    if (this.backupInFlight) return this.backupInFlight;

    this.backupInFlight = super.storeRemoteSession({ emit })
      .then(() => true)
      .catch((error) => {
        this.onEvent('save_failed', { error: String(error?.message ?? error) });
        return false;
      })
      .finally(() => {
        this.backupInFlight = null;
      });
    return this.backupInFlight;
  }

  async afterAuthReady() {
    try {
      const sessionExists = await this.store.sessionExists({ session: this.sessionName });
      if (!sessionExists) await this.delay(60_000);
      if (!this.stopped) {
        await this.safeStoreRemoteSession({ emit: !sessionExists });
      }
    } catch (error) {
      this.onEvent('save_failed', { error: String(error?.message ?? error) });
    } finally {
      if (!this.stopped) {
        this.backupSync = setInterval(
          () => void this.safeStoreRemoteSession(),
          this.backupSyncIntervalMs
        );
      }
    }
  }

  async forceBackup() {
    if (!this.sessionName) return false;
    const sessionExists = await this.store.sessionExists({ session: this.sessionName });
    if (!sessionExists) return false;
    return this.safeStoreRemoteSession();
  }

  async removeLocalSession() {
    if (!this.userDataDir) return;
    await fsPromises.rm(this.userDataDir, {
      recursive: true,
      force: true,
      maxRetries: this.rmMaxRetries,
    }).catch(() => undefined);
  }

  async destroy() {
    this.stopped = true;
    clearInterval(this.backupSync);
  }

  async disconnect() {
    this.stopped = true;
    clearInterval(this.backupSync);
    await this.removeLocalSession();
    this.onEvent('disconnect_preserved', {});
  }

  async purgeRemoteSession() {
    if (!this.sessionName) return;
    await this.store.delete({ session: this.sessionName });
  }

  async logout() {
    this.stopped = true;
    clearInterval(this.backupSync);
    await this.purgeRemoteSession();
    await this.removeLocalSession();
  }
}
