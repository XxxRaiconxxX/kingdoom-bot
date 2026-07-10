import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const HF_DEFAULT_ROOT = '/data/kingdoom-bot';

function readEnv(value) {
  return String(value ?? '').trim();
}

function isHuggingFaceRuntime() {
  return Boolean(
    readEnv(process.env.SPACE_ID) ||
    readEnv(process.env.SPACE_HOST) ||
    readEnv(process.env.HF_SPACE_ID) ||
    readEnv(process.env.SPACE_AUTHOR_NAME) ||
    readEnv(process.env.SYSTEM) === 'spaces'
  );
}

export function getPersistentRootPath() {
  const explicitRoot = readEnv(process.env.PERSISTENT_ROOT_PATH);
  if (explicitRoot) {
    return path.resolve(explicitRoot);
  }

  const explicitAuth = readEnv(process.env.PERSISTENT_DATA_PATH);
  if (explicitAuth) {
    return path.dirname(path.resolve(explicitAuth));
  }

  if (fs.existsSync('/data')) {
    return HF_DEFAULT_ROOT;
  }

  return PROJECT_ROOT;
}

export function getAuthDataPath() {
  const explicitAuth = readEnv(process.env.PERSISTENT_DATA_PATH);
  if (explicitAuth) {
    return path.resolve(explicitAuth);
  }

  return path.join(getPersistentRootPath(), '.wwebjs_auth');
}

export function getAuthFilePath(fileName) {
  return path.join(getAuthDataPath(), fileName);
}

export function getStateFilePath(fileName) {
  return path.join(getAuthDataPath(), 'state', fileName);
}

export function getRuntimeStatusFilePath() {
  const explicitStatus = readEnv(process.env.RUNTIME_STATUS_PATH);
  if (explicitStatus) {
    return path.resolve(explicitStatus);
  }

  return path.join(getPersistentRootPath(), 'runtime-status.json');
}

export function getPersistenceMode() {
  if (readEnv(process.env.PERSISTENT_DATA_PATH)) {
    return 'custom-auth-path';
  }

  if (readEnv(process.env.PERSISTENT_ROOT_PATH)) {
    return 'custom-root-path';
  }

  if (fs.existsSync('/data')) {
    return 'hf-data';
  }

  return 'local';
}

export function isAuthPathLikelyPersistent() {
  if (!isHuggingFaceRuntime()) {
    return true;
  }

  if (!fs.existsSync('/data')) {
    return false;
  }

  const normalizedPath = getAuthDataPath().replace(/\\/g, '/');
  return normalizedPath === '/data' || normalizedPath.startsWith('/data/');
}

export function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function ensureParentDir(filePath) {
  ensureDir(path.dirname(filePath));
}
