import dns from 'node:dns';
try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch {}

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BOT_ENTRY_PATH = fileURLToPath(new URL('./index.js', import.meta.url));
const BASE_RESTART_DELAY_MS = 3000;
const MAX_RESTART_DELAY_MS = 30000;
const STABLE_UPTIME_MS = 5 * 60 * 1000;
const SHUTDOWN_TIMEOUT_MS = 15000;

export function calculateSupervisorDelayMs(restartCount, baseDelayMs = BASE_RESTART_DELAY_MS, maxDelayMs = MAX_RESTART_DELAY_MS) {
  const safeCount = Math.max(1, Number.parseInt(String(restartCount), 10) || 1);
  const safeBase = Math.max(1000, Number(baseDelayMs) || BASE_RESTART_DELAY_MS);
  const safeMax = Math.max(safeBase, Number(maxDelayMs) || MAX_RESTART_DELAY_MS);
  return Math.min(safeMax, safeBase * (2 ** (safeCount - 1)));
}

export function shouldRestartChild({ code, signal, shuttingDown }) {
  return !shuttingDown && (code !== 0 || Boolean(signal));
}

export function startBotSupervisor() {
  let child = null;
  let restartTimer = null;
  let forceKillTimer = null;
  let restartCount = 0;
  let shuttingDown = false;

  const launch = () => {
    const startedAt = Date.now();
    console.log('[supervisor] Iniciando proceso de Kingdoom Bot.');
    child = spawn(process.execPath, [BOT_ENTRY_PATH], {
      env: process.env,
      stdio: 'inherit',
    });

    child.once('error', (error) => {
      console.error('[supervisor] No se pudo iniciar el proceso del bot:', error.message);
    });

    child.once('close', (code, signal) => {
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
        forceKillTimer = null;
      }

      child = null;
      if (!shouldRestartChild({ code, signal, shuttingDown })) {
        process.exitCode = typeof code === 'number' ? code : 0;
        return;
      }

      if (Date.now() - startedAt >= STABLE_UPTIME_MS) {
        restartCount = 0;
      }
      restartCount += 1;
      const delayMs = calculateSupervisorDelayMs(restartCount);
      console.warn(
        `[supervisor] El bot termino con codigo ${String(code)}${signal ? ` y senal ${signal}` : ''}. ` +
        `Se reiniciara dentro del mismo contenedor en ${Math.round(delayMs / 1000)}s.`
      );
      restartTimer = setTimeout(() => {
        restartTimer = null;
        launch();
      }, delayMs);
    });
  };

  const forwardShutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;

    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }

    if (!child) {
      process.exitCode = 0;
      return;
    }

    console.log(`[supervisor] Reenviando ${signal} al proceso del bot.`);
    child.kill(signal);
    forceKillTimer = setTimeout(() => {
      if (child && child.exitCode === null && child.signalCode === null) {
        console.warn('[supervisor] El bot no cerro a tiempo; enviando SIGKILL.');
        child.kill('SIGKILL');
      }
    }, SHUTDOWN_TIMEOUT_MS);
  };

  process.once('SIGTERM', () => forwardShutdown('SIGTERM'));
  process.once('SIGINT', () => forwardShutdown('SIGINT'));
  launch();
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  startBotSupervisor();
}
