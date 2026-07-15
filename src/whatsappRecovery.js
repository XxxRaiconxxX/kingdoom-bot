import fs from 'node:fs';
import path from 'node:path';

const CHROMIUM_LOCK_FILES = [
  'DevToolsActivePort',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
];

export function cleanupStaleChromiumLocks(authDataPath) {
  const sessionPath = path.join(authDataPath, 'session');
  const removed = [];

  for (const fileName of CHROMIUM_LOCK_FILES) {
    const filePath = path.join(sessionPath, fileName);
    if (!fs.existsSync(filePath)) continue;

    fs.rmSync(filePath, { force: true, recursive: true });
    removed.push(fileName);
  }

  return removed;
}

export function calculateReconnectDelayMs(attempt, baseDelayMs, maxDelayMs) {
  const safeAttempt = Math.max(1, Number.parseInt(String(attempt), 10) || 1);
  const safeBase = Math.max(1000, Number(baseDelayMs) || 1000);
  const safeMax = Math.max(safeBase, Number(maxDelayMs) || safeBase);
  return Math.min(safeMax, safeBase * (2 ** (safeAttempt - 1)));
}

export function classifyWhatsappRuntimeError(error) {
  const message = String(error?.message ?? error).toLowerCase();
  const transientContext =
    message.includes('execution context was destroyed') ||
    message.includes('most likely because of a navigation');
  const restartable = [
    'auth timeout',
    'err_timed_out',
    'target closed',
    'session closed',
    'protocol error',
  ].some((marker) => message.includes(marker));

  return { transientContext, restartable };
}
