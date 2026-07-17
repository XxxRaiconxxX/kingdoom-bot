import fs from 'node:fs';
import path from 'node:path';

const CHROMIUM_LOCK_FILES = [
  'DevToolsActivePort',
  'SingletonCookie',
  'SingletonLock',
  'SingletonSocket',
];
const TRANSIENT_WHATSAPP_STATES = new Set(['OPENING', 'PAIRING', 'TIMEOUT']);

function toSafeCount(value) {
  return Math.max(0, Number.parseInt(String(value ?? 0), 10) || 0);
}

function normalizeReconnectRecord(value) {
  if (!value || typeof value !== 'object') return null;

  const startedAt = String(value.startedAt ?? '');
  if (!Number.isFinite(Date.parse(startedAt))) return null;

  return {
    id: String(value.id ?? ''),
    trigger: String(value.trigger ?? 'unknown'),
    startedAt,
    authReset: value.authReset === true,
    ...(value.completedAt ? { completedAt: String(value.completedAt) } : {}),
    ...(value.outcome ? { outcome: String(value.outcome) } : {}),
    ...(value.proof ? { proof: String(value.proof) } : {}),
    ...(Number.isFinite(Number(value.durationMs)) ? { durationMs: Math.max(0, Number(value.durationMs)) } : {}),
  };
}

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

export function isTransientWhatsappState(state) {
  return TRANSIENT_WHATSAPP_STATES.has(String(state ?? '').trim().toUpperCase());
}

export function recordPersistenceBoot(markerPath, {
  persistent = true,
  currentBootAt = new Date().toISOString(),
  processId = process.pid,
} = {}) {
  if (!persistent) {
    return {
      status: 'ephemeral',
      verifiedAcrossRestart: false,
      previousBootAt: null,
      error: null,
    };
  }

  let previousBootAt = null;
  let temporaryPath = null;
  try {
    let firstSeenAt = currentBootAt;
    if (fs.existsSync(markerPath)) {
      const previousMarker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
      previousBootAt = String(previousMarker?.currentBootAt ?? '') || null;
      firstSeenAt = String(previousMarker?.firstSeenAt ?? previousBootAt ?? currentBootAt);
    }

    temporaryPath = `${markerPath}.${processId}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify({
      firstSeenAt,
      previousBootAt,
      currentBootAt,
    }, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, markerPath);

    return {
      status: previousBootAt ? 'verified_across_restart' : 'writable_awaiting_restart',
      verifiedAcrossRestart: Boolean(previousBootAt),
      previousBootAt,
      error: null,
    };
  } catch (error) {
    if (temporaryPath && fs.existsSync(temporaryPath)) {
      fs.rmSync(temporaryPath, { force: true });
    }
    return {
      status: 'write_failed',
      verifiedAcrossRestart: false,
      previousBootAt,
      error: String(error?.message ?? error),
    };
  }
}

export function createReconnectAudit(initialTelemetry = {}, now = () => Date.now()) {
  let attemptCount = toSafeCount(initialTelemetry.reconnectAttemptCount);
  let verifiedCount = toSafeCount(initialTelemetry.reconnectVerifiedCount);
  let failedCount = toSafeCount(initialTelemetry.reconnectFailedCount);
  let pendingAttempt = normalizeReconnectRecord(initialTelemetry.pendingReconnectAttempt);
  let lastResult = normalizeReconnectRecord(initialTelemetry.lastReconnectResult);

  function snapshot() {
    return {
      reconnectAttemptCount: attemptCount,
      reconnectVerifiedCount: verifiedCount,
      reconnectFailedCount: failedCount,
      pendingReconnectAttempt: pendingAttempt ? { ...pendingAttempt } : null,
      lastReconnectResult: lastResult ? { ...lastResult } : null,
    };
  }

  function start(trigger, { authReset = false } = {}) {
    if (pendingAttempt) {
      if (authReset) pendingAttempt.authReset = true;
      return { ...pendingAttempt };
    }

    const startedAtMs = now();
    attemptCount += 1;
    pendingAttempt = {
      id: `${startedAtMs}-${attemptCount}`,
      trigger: String(trigger || 'unknown'),
      startedAt: new Date(startedAtMs).toISOString(),
      authReset,
    };
    return { ...pendingAttempt };
  }

  function complete(outcome, proof) {
    if (!pendingAttempt) return null;

    const completedAtMs = now();
    const startedAtMs = Date.parse(pendingAttempt.startedAt);
    lastResult = {
      ...pendingAttempt,
      completedAt: new Date(completedAtMs).toISOString(),
      outcome,
      proof: String(proof || 'unknown'),
      durationMs: Math.max(0, completedAtMs - startedAtMs),
    };
    pendingAttempt = null;

    if (outcome === 'verified') verifiedCount += 1;
    else failedCount += 1;

    return { ...lastResult };
  }

  return {
    snapshot,
    start,
    completeVerified: (proof) => complete('verified', proof),
    completeFailed: (reason) => complete('failed', reason),
  };
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
