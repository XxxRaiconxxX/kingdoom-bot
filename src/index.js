import http from 'http';
import fs from 'fs';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import qrcodeImage from 'qrcode';
import 'dotenv/config';
import { handlePlayerMessage } from './handlers/player.js';
import { handleAdminCommand } from './handlers/admin.js';
import { handleCofre, handleDados, handleOraculo, handleTrampa } from './handlers/games.js';
import { buildWelcomeConfig, handleGroupWelcome, sendLatestApk } from './handlers/welcome.js';
import { buildPlayerLifecycleConfig, handleGroupLeave, handleGroupRejoin } from './handlers/playerLifecycle.js';
import {
  registerPlayer,
  getPlayer,
  getPlayersByPhone,
  touchPlayerActivity,
  markRoleplayActivityForPhone,
  getPlayerRoleplayAccess,
  isRoleplayAccessCurrentlyLocked,
  getRoleplayLockWindowDays,
  updateGold,
  getRestrictedGroupCommandViolationsForDay,
  recordRestrictedGroupCommandViolation,
  botStateSupabase,
  getUnresolvedBets,
  resolveBet,
} from './supabase.js';
import { startScheduler } from './scheduler.js';
import { isAdminUser, isStaffUser, normalizePhone, formatJid } from './adminStore.js';
import { processTrackerMessage, buildGMPrompt, buildGMUserPayload, registerGMResponse, buildVisibleGMResponse, assessGMResponse, buildFallbackCompletedGMResponse, initMissionTracker } from './gmTracker.js';
import { askKingdoomAI } from './ai.js';
import { handleMarketForgeConversation } from './handlers/marketForge.js';
import { handleBlackjack, handleBlackjackReply, activeSessions } from './handlers/blackjack.js';
import { activeTreasures, handleTreasureReply, clearTreasureTimeouts } from './handlers/treasure.js';
import { getMarketForgeSession } from './marketForgeStore.js';
import { startAuctionsRealtime } from './handlers/auctionsRealtime.js';
import {
  ensureDir,
  ensureParentDir,
  getAuthDataPath,
  getPersistenceMode,
  getRuntimeStatusFilePath,
  isAuthPathLikelyPersistent,
} from './runtimePaths.js';
import { calculateReconnectDelayMs, cleanupStaleChromiumLocks } from './whatsappRecovery.js';

const { Client, LocalAuth } = pkg;

const PORT = process.env.PORT || 3000;
const WHATSAPP_INIT_MAX_RETRIES = Math.max(
  1,
  Number.parseInt(process.env.WHATSAPP_INIT_MAX_RETRIES ?? '5', 10) || 5
);
const WHATSAPP_INIT_RETRY_DELAY_MS = Math.max(
  5000,
  Number.parseInt(process.env.WHATSAPP_INIT_RETRY_DELAY_MS ?? '15000', 10) || 15000
);
const WHATSAPP_AUTH_TIMEOUT_MS = Math.max(
  120000,
  Number.parseInt(process.env.WHATSAPP_AUTH_TIMEOUT_MS ?? '300000', 10) || 300000
);
const WHATSAPP_CONNECT_STALL_TIMEOUT_MS = Math.max(
  60000,
  Number.parseInt(process.env.WHATSAPP_CONNECT_STALL_TIMEOUT_MS ?? '150000', 10) || 150000
);
const WHATSAPP_RESTART_GRACE_MS = Math.max(
  1000,
  Number.parseInt(process.env.WHATSAPP_RESTART_GRACE_MS ?? '2500', 10) || 2500
);
const WHATSAPP_RECONNECT_MAX_DELAY_MS = Math.max(
  WHATSAPP_INIT_RETRY_DELAY_MS,
  Number.parseInt(process.env.WHATSAPP_RECONNECT_MAX_DELAY_MS ?? '60000', 10) || 60000
);
const WHATSAPP_SHUTDOWN_TIMEOUT_MS = Math.max(
  3000,
  Number.parseInt(process.env.WHATSAPP_SHUTDOWN_TIMEOUT_MS ?? '8000', 10) || 8000
);
const WHATSAPP_TAKEOVER_ON_CONFLICT =
  String(process.env.WHATSAPP_TAKEOVER_ON_CONFLICT ?? 'true').trim().toLowerCase() !== 'false';
const WHATSAPP_TAKEOVER_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.WHATSAPP_TAKEOVER_TIMEOUT_MS ?? '10000', 10) || 10000
);
const WHATSAPP_PAIR_PHONE_NUMBER = String(process.env.WHATSAPP_PAIR_PHONE_NUMBER ?? '').replace(/\D/g, '');
const WHATSAPP_PAIR_SHOW_NOTIFICATION =
  String(process.env.WHATSAPP_PAIR_SHOW_NOTIFICATION ?? 'true').trim().toLowerCase() !== 'false';
const WHATSAPP_PAIR_INTERVAL_MS = Math.max(
  60000,
  Number.parseInt(process.env.WHATSAPP_PAIR_INTERVAL_MS ?? '180000', 10) || 180000
);
const RESET_AUTH_ENABLED = String(process.env.RESET_AUTH_ENABLED ?? 'false').trim().toLowerCase() === 'true';
const RESET_AUTH_TOKEN = String(process.env.RESET_AUTH_TOKEN ?? '').trim();
const WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE =
  String(process.env.WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE ?? 'false').trim().toLowerCase() === 'true';
const authDataPath = getAuthDataPath();
const runtimeStatusFilePath = getRuntimeStatusFilePath();
const persistenceMode = getPersistenceMode();
const authPathPersistent = isAuthPathLikelyPersistent();

ensureDir(authDataPath);
ensureParentDir(runtimeStatusFilePath);
console.log(
  `[runtime] authDataPath=${authDataPath} persistenceMode=${persistenceMode} persistent=${authPathPersistent}`
);
if (!authPathPersistent) {
  console.warn(
    '[runtime] La sesion de WhatsApp esta en almacenamiento no persistente. Si el contenedor reinicia, puede volver a pedir QR.'
  );
}
if (WHATSAPP_PAIR_PHONE_NUMBER) {
  console.log('[runtime] Modo de vinculacion por numero telefonico habilitado.');
}

let latestQrDataUrl = '';
let latestQrUpdatedAt = null;
let latestPairingCode = '';
let latestPairingCodeUpdatedAt = null;
let lastLoadingPercent = null;
let appStatus = 'Inicializando servidor...';
let whatsappClientReady = false;
let lastWhatsappProgressAt = Date.now();
const welcomeConfig = buildWelcomeConfig();
const playerLifecycleConfig = buildPlayerLifecycleConfig();
let schedulerStarted = false;
let realtimeStarted = false;
let readyBootstrapComplete = false;
let restartRequested = false;
let shutdownRequested = false;
let initializePromise = null;
const COMMAND_PROCESSING_WARN_MS = Math.max(
  15000,
  Number.parseInt(process.env.COMMAND_PROCESSING_WARN_MS ?? '30000', 10) || 30000
);
const RESTRICTED_MINIGAME_GROUP_ID = '595971938097-1618930274@g.us';
const RESTRICTED_MINIGAME_SCOPE_KEY = 'main';
const RESTRICTED_MINIGAME_COMMANDS = new Set(['cofre', 'trampa', '21']);
const ROLEPLAY_ACTIVITY_GROUP_ID = process.env.ROLEPLAY_ACTIVITY_GROUP_ID || '120363024420812768@g.us';
const ROLEPLAY_ACTIVITY_TOUCH_INTERVAL_MS = Math.max(
  60 * 1000,
  Number.parseInt(process.env.ROLEPLAY_ACTIVITY_TOUCH_INTERVAL_MS ?? '900000', 10) || 900000
);
const ROLEPLAY_BLOCKED_COMMANDS = new Set([
  'dados',
  'cofre',
  'trampa',
  '21',
  'oraculo',
  'mercado',
  'item',
  'subasta',
  'subastas',
  'pujar',
  'puja',
  'retirarse',
  'oro',
  'gold',
  'ricos',
  'fortunas',
]);
const restrictedGroupLocks = new Map();
const roleplayActivityCache = new Map();

function normalizeCommandText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseCommand(value) {
  const normalized = normalizeCommandText(value);
  if (!normalized) {
    return { normalized, hasPrefix: false, command: '', body: '' };
  }

  const hasPrefix = normalized.startsWith('!');
  const sanitized = hasPrefix ? normalized.slice(1) : normalized;
  const [command = '', ...rest] = sanitized.split(/\s+/);

  return {
    normalized,
    hasPrefix,
    command,
    body: rest.join(' ').trim(),
  };
}

function ensurePrefixedBody(command, originalBody, parsedBody) {
  if (normalizeCommandText(originalBody).startsWith('!')) {
    return originalBody;
  }

  return `!${command}${parsedBody ? ` ${parsedBody}` : ''}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summarizeTextForLog(value, maxLength = 120) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(16, maxLength));
}

function runRestrictedGroupSerial(key, task) {
  const previous = restrictedGroupLocks.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task);

  restrictedGroupLocks.set(
    key,
    next.finally(() => {
      if (restrictedGroupLocks.get(key) === next) {
        restrictedGroupLocks.delete(key);
      }
    })
  );

  return next;
}

function formatGoldAmount(value) {
  return Number(value ?? 0).toLocaleString('es-PY');
}

function getRestrictedCommandPenalty(previousViolationsCount) {
  if (previousViolationsCount <= 0) {
    return 0;
  }

  return 5000 * (2 ** (previousViolationsCount - 1));
}

function buildRestrictedGroupWarningReply(commandName) {
  return [
    `⚠️ El comando *!${commandName}* no puede usarse en este grupo principal.`,
    'Por favor envia mensaje al privado para continuar con este comando.',
    'Esta fue tu advertencia gratuita de hoy.',
  ].join('\n');
}

function buildRestrictedGroupPenaltyReply(commandName, desiredPenalty, appliedPenalty, availableGoldAfter) {
  const baseLines = [
    `⛔ El comando *!${commandName}* no puede usarse en este grupo principal.`,
    'Por favor envia mensaje al privado para continuar con este comando.',
  ];

  if (appliedPenalty <= 0) {
    baseLines.push(`No se pudo descontar oro porque no habia saldo disponible. Multa prevista: *${formatGoldAmount(desiredPenalty)} oro*.`);
    return baseLines.join('\n');
  }

  if (appliedPenalty < desiredPenalty) {
    baseLines.push(`Se descontaron *${formatGoldAmount(appliedPenalty)} oro* (todo tu saldo disponible).`);
  } else {
    baseLines.push(`Se descontaron *${formatGoldAmount(appliedPenalty)} oro* por reincidir hoy.`);
  }

  baseLines.push(`Oro restante: *${formatGoldAmount(availableGoldAfter)}*`);
  return baseLines.join('\n');
}

function buildRestrictedGroupPrivateReply(commandName) {
  return [
    `⚠️ *!${commandName}* no se usa en el grupo principal del reino.`,
    'Reenvia aqui ese comando por privado y el bot lo atendera sin problemas.',
    'En el grupo principal las reincidencias generan multa de oro durante el dia.',
  ].join('\n');
}

function getRandomDelayMs(minMs, maxMs) {
  const safeMin = Math.max(0, Math.floor(minMs));
  const safeMax = Math.max(safeMin, Math.floor(maxMs));
  return safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
}

function isLikelyLowEffortRoleplayText(value) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  if (!normalized) {
    return true;
  }

  const trivialReplies = new Set([
    'ok',
    'oka',
    'xd',
    'xD',
    'si',
    'sí',
    'no',
    'dale',
    'jaja',
    'ajaj',
    'jsjs',
    'lol',
    'uh',
    'ah',
    'hey',
  ]);

  if (trivialReplies.has(normalized)) {
    return true;
  }

  const alphaNumeric = normalized.replace(/[^a-z0-9\s]/g, ' ').trim();
  const words = alphaNumeric.split(/\s+/).filter(Boolean);
  const compactLength = alphaNumeric.replace(/\s+/g, '').length;

  if (compactLength < 12 && words.length < 3) {
    return true;
  }

  return false;
}

function isEligibleRoleplayActivityMessage(msg, text) {
  if (msg.from !== ROLEPLAY_ACTIVITY_GROUP_ID) return false;
  if (!text) return false;
  if (text.startsWith('!')) return false;
  if (msg.hasMedia) return false;
  if (isLikelyLowEffortRoleplayText(text)) return false;
  return true;
}

function buildRoleplayLockedReply(commandName) {
  return [
    `⚠️ Tu acceso a *!${commandName}* esta bloqueado por no haber roleado en los ultimos *${getRoleplayLockWindowDays()} dias*.`,
    'Vuelve a rolear en el grupo principal del reino para desbloquear minijuegos, economia y consultas recreativas.',
    `Grupo valido: *${ROLEPLAY_ACTIVITY_GROUP_ID}*`,
  ].join('\n');
}

function formatInitializeError(error) {
  if (!error) {
    return 'Unknown initialization error';
  }

  const message = String(error?.message ?? error);
  if (message.includes('ERR_TIMED_OUT')) {
    return `${message} | Posible causa: timeout de red saliente hacia web.whatsapp.com en el contenedor.`;
  }
  if (message.toLowerCase().includes('auth timeout')) {
    return `${message} | Posible causa: autenticacion lenta o sesion de WhatsApp expirada en el contenedor.`;
  }

  return message;
}

function isPuppeteerDeliveryAmbiguousError(error) {
  const message = String(error?.message ?? error);
  return message.includes('Protocol error') && message.includes('Promise was collected');
}

function isLogoutDisconnectReason(reason) {
  return String(reason ?? '').trim().toUpperCase() === 'LOGOUT';
}

function clearAuthDataPath(reasonLabel) {
  try {
    if (!fs.existsSync(authDataPath)) {
      return false;
    }

    fs.rmSync(authDataPath, { recursive: true, force: true });
    console.log(`[auth cleanup] Carpeta de autenticacion eliminada: ${reasonLabel}`);
    return true;
  } catch (error) {
    console.error('[auth cleanup] Error al eliminar carpeta de autenticacion:', error);
    return false;
  }
}

function markWhatsappProgress() {
  lastWhatsappProgressAt = Date.now();
}

function normalizeOutgoingText(value) {
  const normalized = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();

  return normalized || 'El reino no encontro palabras para responder.';
}

function splitOutgoingText(value, maxLength = 3200) {
  const text = normalizeOutgoingText(value);
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    const boundary = Math.max(
      remaining.lastIndexOf('\n\n', maxLength),
      remaining.lastIndexOf('\n', maxLength),
      remaining.lastIndexOf('. ', maxLength),
      remaining.lastIndexOf(' ', maxLength)
    );
    const splitAt = boundary > maxLength * 0.45 ? boundary + 1 : maxLength;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining) {
    chunks.push(remaining);
  }

  return chunks;
}

function buildPlainTextFallback(value) {
  return normalizeOutgoingText(value)
    .replace(/[*_~`]/g, '')
    .replace(/\n{3,}/g, '\n\n');
}

async function sendBotText(msg, text, { preferReply = true, context = 'message' } = {}) {
  const chunks = splitOutgoingText(text);

  for (const [index, chunk] of chunks.entries()) {
    const shouldReply = preferReply && index === 0;
    if (shouldReply) {
      try {
        await msg.reply(chunk);
        continue;
      } catch (replyError) {
        console.warn(`[delivery:${context}] msg.reply fallo; intentando envio directo.`, replyError?.message ?? replyError);
      }
    }

    try {
      await client.sendMessage(msg.from, chunk);
    } catch (directError) {
      const plainText = buildPlainTextFallback(chunk);
      if (plainText !== chunk) {
        console.warn(`[delivery:${context}] envio directo fallo; reintentando como texto plano.`, directError?.message ?? directError);
        await client.sendMessage(msg.from, plainText);
        continue;
      }

      throw directError;
    }
  }
}

async function sendEmergencyText(msg, text, context = 'emergency') {
  try {
    await sendBotText(msg, text, { preferReply: false, context });
  } catch (deliveryError) {
    console.error(`[delivery:${context}] No se pudo enviar el aviso de error:`, deliveryError);
  }
}

function readPersistedRuntimeStatus() {
  try {
    if (!fs.existsSync(runtimeStatusFilePath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(runtimeStatusFilePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    console.error('[runtime status read]', error.message);
    return null;
  }
}

function formatStatusTimestamp(value) {
  if (!value) {
    return 'Sin registro';
  }

  try {
    return new Date(value).toLocaleString('es-PY', { timeZone: 'America/Asuncion' });
  } catch {
    return String(value);
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRequesterAddress(req) {
  return String(req.headers['x-forwarded-for'] ?? req.socket?.remoteAddress ?? 'unknown')
    .split(',')[0]
    .trim();
}

const persistedRuntimeStatus = readPersistedRuntimeStatus();

let runtimeStatus = {
  appStartedAt: new Date().toISOString(),
  status: appStatus,
  lastEvent: persistedRuntimeStatus?.lastEvent ?? 'boot',
  lastEventAt: persistedRuntimeStatus?.lastEventAt ?? null,
  lastEventDetail: persistedRuntimeStatus?.lastEventDetail ?? '',
  recentEvents: Array.isArray(persistedRuntimeStatus?.recentEvents)
    ? persistedRuntimeStatus.recentEvents.slice(0, 40)
    : [],
  restartCount: Number.parseInt(String(persistedRuntimeStatus?.restartCount ?? 0), 10) || 0,
};

function buildPublicStatus() {
  return {
    status: appStatus,
    qrVisible: Boolean(latestQrDataUrl),
    qrLastUpdatedAt: latestQrUpdatedAt,
    pairingCodeEnabled: Boolean(WHATSAPP_PAIR_PHONE_NUMBER),
    pairingCodeVisible: Boolean(latestPairingCode),
    pairingCode: latestPairingCode || null,
    pairingCodeLastUpdatedAt: latestPairingCodeUpdatedAt,
    lastEvent: runtimeStatus.lastEvent,
    lastEventAt: runtimeStatus.lastEventAt,
    lastEventDetail: runtimeStatus.lastEventDetail,
    recentEvents: runtimeStatus.recentEvents.slice(0, 12),
    restartCount: runtimeStatus.restartCount,
    authPersistence: authPathPersistent ? 'persistent' : 'ephemeral',
    persistenceMode,
    manualResetMode:
      RESET_AUTH_ENABLED && RESET_AUTH_TOKEN
        ? 'token-protected'
        : RESET_AUTH_ENABLED
          ? 'misconfigured'
          : 'disabled',
    appStartedAt: runtimeStatus.appStartedAt,
  };
}

function persistRuntimeStatus() {
  try {
    fs.writeFileSync(runtimeStatusFilePath, `${JSON.stringify(buildPublicStatus(), null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error('[runtime status write]', error.message);
  }
}

function recordRuntimeEvent(event, detail = '', statusOverride = null) {
  if (statusOverride) {
    appStatus = statusOverride;
  }

  const entry = {
    at: new Date().toISOString(),
    event,
    status: appStatus,
    detail: String(detail ?? '').slice(0, 1000),
  };

  runtimeStatus = {
    ...runtimeStatus,
    status: appStatus,
    lastEvent: event,
    lastEventAt: entry.at,
    lastEventDetail: entry.detail,
    recentEvents: [entry, ...runtimeStatus.recentEvents].slice(0, 40),
  };

  console.log(
    `[runtime event] ${entry.at} event=${entry.event} status="${entry.status}"${entry.detail ? ` detail="${entry.detail}"` : ''}`
  );
  persistRuntimeStatus();
  return entry;
}

function renderStatusMetaHtml() {
  const recentEventsHtml = runtimeStatus.recentEvents
    .slice(0, 3)
    .map((entry) => {
      const detailHtml = entry.detail
        ? `<span style="display:block;color:#a3a3a8;font-size:12px;line-height:1.45;margin-top:4px;">${escapeHtml(entry.detail)}</span>`
        : '';
      return `<li style="list-style:none;background:#151515;border:1px solid #262626;border-radius:10px;padding:10px 12px;text-align:left;"><strong style="display:block;color:#f5f5f7;margin-bottom:2px;">${escapeHtml(entry.event)}</strong><span style="display:block;color:#9696a0;font-size:12px;">${formatStatusTimestamp(entry.at)}</span>${detailHtml}</li>`;
    })
    .join('');

  const storageLabel = authPathPersistent ? 'Persistente' : 'Temporal';
  const resetLabel =
    RESET_AUTH_ENABLED && RESET_AUTH_TOKEN
      ? 'Protegido por token'
      : RESET_AUTH_ENABLED
        ? 'Mal configurado'
        : 'Desactivado';

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:18px;">
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Sesion</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;">${storageLabel}</strong>
        <small style="display:block;color:#9696a0;">${persistenceMode}</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Reset manual</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;">${resetLabel}</strong>
        <small style="display:block;color:#9696a0;">/status.json disponible</small>
      </div>
    </div>
    <div style="margin-top:18px;text-align:left;border-top:1px solid #2a2a2a;padding-top:14px;">
      <p style="margin:6px 0;color:#a3a3a8;font-size:14px;"><strong style="color:#f5f5f7;">Ultimo evento:</strong> ${escapeHtml(runtimeStatus.lastEvent || 'sin datos')}${runtimeStatus.lastEventAt ? ` · ${formatStatusTimestamp(runtimeStatus.lastEventAt)}` : ''}</p>
      ${runtimeStatus.lastEventDetail ? `<p>${escapeHtml(runtimeStatus.lastEventDetail)}</p>` : ''}
      ${recentEventsHtml ? `<ul style="padding:0;margin:12px 0 0;display:grid;gap:8px;">${recentEventsHtml}</ul>` : ''}
    </div>
  `;
}

function renderAutoRefreshScript() {
  const currentStatus = buildPublicStatus();
  const markers = JSON.stringify({
    status: currentStatus.status ?? '',
    qrVisible: currentStatus.qrVisible === true,
    lastEvent: currentStatus.lastEvent ?? '',
    lastEventAt: currentStatus.lastEventAt ?? '',
    qrLastUpdatedAt: currentStatus.qrLastUpdatedAt ?? '',
    pairingCodeVisible: currentStatus.pairingCodeVisible === true,
    pairingCodeLastUpdatedAt: currentStatus.pairingCodeLastUpdatedAt ?? '',
  });

  return `
    <script>
      (() => {
        const markers = ${markers};
        let syncInFlight = false;

        const qrImage = document.getElementById('qr-image');
        const qrStatusValue = document.getElementById('qr-status-value');
        const qrUpdatedLabel = document.getElementById('qr-updated-label');
        const qrHint = document.getElementById('qr-sync-hint');

        const formatTimestamp = (value) => {
          if (!value) {
            return 'Sin registro';
          }

          try {
            return new Date(value).toLocaleString('es-PY', { timeZone: 'America/Asuncion' });
          } catch (error) {
            return String(value);
          }
        };

        const updateMarkerState = (next) => {
          markers.status = String(next.status ?? '');
          markers.qrVisible = Boolean(next.qrVisible);
          markers.lastEvent = String(next.lastEvent ?? '');
          markers.lastEventAt = String(next.lastEventAt ?? '');
          markers.qrLastUpdatedAt = String(next.qrLastUpdatedAt ?? '');
          markers.pairingCodeVisible = Boolean(next.pairingCodeVisible);
          markers.pairingCodeLastUpdatedAt = String(next.pairingCodeLastUpdatedAt ?? '');
        };

        const reloadPage = () => {
          window.location.replace('/?ts=' + Date.now());
        };

        const applyLiveQrUpdate = async (next) => {
          if (!qrImage || !next.qrVisible) {
            return false;
          }

          const qrResponse = await fetch('/qr.json?ts=' + encodeURIComponent(next.qrLastUpdatedAt || Date.now()), {
            cache: 'no-store',
          });
          if (!qrResponse.ok) {
            return false;
          }

          const qrPayload = await qrResponse.json();
          if (!qrPayload || !qrPayload.qrDataUrl) {
            return false;
          }

          qrImage.style.opacity = '0.35';
          qrImage.style.transform = 'scale(0.985)';
          qrImage.addEventListener('load', () => {
            qrImage.style.opacity = '1';
            qrImage.style.transform = 'scale(1)';
          }, { once: true });
          qrImage.src = qrPayload.qrDataUrl;
          qrImage.dataset.qrUpdatedAt = String(qrPayload.qrLastUpdatedAt ?? '');

          if (qrStatusValue) {
            qrStatusValue.textContent = String(next.status ?? '');
          }
          if (qrUpdatedLabel) {
            qrUpdatedLabel.textContent = 'Ultima renovacion del QR: ' + formatTimestamp(qrPayload.qrLastUpdatedAt);
          }
          if (qrHint) {
            qrHint.textContent = 'El QR fue renovado automaticamente. Si WhatsApp rechazo el anterior, escanea este nuevo codigo.';
          }

          updateMarkerState(next);
          return true;
        };

        const sync = async () => {
          if (syncInFlight) {
            return;
          }

          syncInFlight = true;
          try {
            const response = await fetch('/status.json?ts=' + Date.now(), { cache: 'no-store' });
            if (!response.ok) {
              return;
            }

            const next = await response.json();
            const qrChanged =
              String(next.qrLastUpdatedAt ?? '') !== String(markers.qrLastUpdatedAt ?? '');
            const pairingChanged =
              String(next.pairingCodeLastUpdatedAt ?? '') !== String(markers.pairingCodeLastUpdatedAt ?? '');
            const structureChanged =
              Boolean(next.qrVisible) !== Boolean(markers.qrVisible) ||
              Boolean(next.pairingCodeVisible) !== Boolean(markers.pairingCodeVisible);
            const eventChanged =
              String(next.lastEvent ?? '') !== String(markers.lastEvent ?? '') ||
              String(next.lastEventAt ?? '') !== String(markers.lastEventAt ?? '');
            const statusChanged =
              String(next.status ?? '') !== String(markers.status ?? '');

            if (qrChanged && !structureChanged) {
              const updatedInline = await applyLiveQrUpdate(next);
              if (updatedInline) {
                return;
              }
            }

            if (structureChanged || eventChanged || statusChanged || qrChanged || pairingChanged) {
              reloadPage();
            }
          } catch (error) {
            console.warn('status poll failed', error);
          } finally {
            syncInFlight = false;
          }
        };

        window.setInterval(sync, 4000);
      })();
    </script>
  `;
}

function startWhatsappConnectWatchdog() {
  const interval = setInterval(() => {
    const hasFreshQr =
      !!latestQrDataUrl &&
      !!latestQrUpdatedAt &&
      Number.isFinite(Date.parse(latestQrUpdatedAt)) &&
      (Date.now() - Date.parse(latestQrUpdatedAt)) < WHATSAPP_CONNECT_STALL_TIMEOUT_MS;
    const hasFreshPairingCode =
      !!latestPairingCode &&
      !!latestPairingCodeUpdatedAt &&
      Number.isFinite(Date.parse(latestPairingCodeUpdatedAt)) &&
      (Date.now() - Date.parse(latestPairingCodeUpdatedAt)) < WHATSAPP_CONNECT_STALL_TIMEOUT_MS;

    if (whatsappClientReady || hasFreshQr || hasFreshPairingCode) {
      return;
    }

    const idleMs = Date.now() - lastWhatsappProgressAt;
    if (idleMs < WHATSAPP_CONNECT_STALL_TIMEOUT_MS) {
      return;
    }

    const stallContext = latestQrDataUrl
      ? 'QR vencido sin progreso'
      : latestPairingCode
        ? 'codigo de vinculacion vencido sin progreso'
        : 'sin QR ni conexion';
    const reconnectDelayMs = calculateReconnectDelayMs(
      runtimeStatus.restartCount + 1,
      WHATSAPP_INIT_RETRY_DELAY_MS,
      WHATSAPP_RECONNECT_MAX_DELAY_MS
    );
    requestProcessRestart(
      'connect_watchdog_restart',
      `${stallContext} despues de ${Math.round(idleMs / 1000)}s.`,
      { delayMs: reconnectDelayMs }
    );
  }, 30000);

  if (typeof interval.unref === 'function') {
    interval.unref();
  }
}

recordRuntimeEvent(
  'boot',
  persistedRuntimeStatus?.lastEvent
    ? `Ultimo evento previo: ${persistedRuntimeStatus.lastEvent}${persistedRuntimeStatus.lastEventAt ? ` (${formatStatusTimestamp(persistedRuntimeStatus.lastEventAt)})` : ''}.`
    : 'Arranque del proceso.',
  'Inicializando servidor...'
);
startWhatsappConnectWatchdog();

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const htmlHeaders = {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
  };

  if (url.pathname === '/status' || url.pathname === '/status.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    });
    res.end(`${JSON.stringify(buildPublicStatus(), null, 2)}\n`);
    return;
  }

  if (url.pathname === '/qr' || url.pathname === '/qr.json') {
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    });
    res.end(`${JSON.stringify({
      status: appStatus,
      qrVisible: Boolean(latestQrDataUrl),
      qrDataUrl: latestQrDataUrl || null,
      qrLastUpdatedAt: latestQrUpdatedAt,
    }, null, 2)}\n`);
    return;
  }

  if (url.pathname === '/reset-auth' || url.pathname === '/reset') {
    const requesterAddress = getRequesterAddress(req);

    if (!RESET_AUTH_ENABLED) {
      console.warn(`[HTTP Reset] Intento bloqueado desde ${requesterAddress}: endpoint desactivado.`);
      res.writeHead(404, htmlHeaders);
      res.end('Not found');
      return;
    }

    if (!RESET_AUTH_TOKEN) {
      recordRuntimeEvent(
        'manual_reset_misconfigured',
        `Se intento usar reset manual desde ${requesterAddress}, pero falta RESET_AUTH_TOKEN.`,
        'Reset manual mal configurado.'
      );
      res.writeHead(503, htmlHeaders);
      res.end('<h1>Reset manual mal configurado</h1><p>Falta RESET_AUTH_TOKEN en el entorno.</p>');
      return;
    }

    const suppliedToken = String(url.searchParams.get('token') ?? req.headers['x-reset-token'] ?? '').trim();
    if (suppliedToken !== RESET_AUTH_TOKEN) {
      recordRuntimeEvent(
        'manual_reset_denied',
        `Token invalido para reset manual desde ${requesterAddress}.`,
        'Intento de reset manual bloqueado.'
      );
      res.writeHead(403, htmlHeaders);
      res.end('<h1>403</h1><p>Token invalido para reset manual.</p>');
      return;
    }

    recordRuntimeEvent(
      'manual_reset_authorized',
      `Reset manual autorizado desde ${requesterAddress}.`,
      'Reset manual autorizado. Reiniciando bot...'
    );

    res.writeHead(200, htmlHeaders);
    res.end(`
      <html>
        <head>
          <title>Kingdoom Bot - Reset</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            body {
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              background-color: #121212;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              margin: 0;
              color: #f5f5f7;
            }
            .container {
              text-align: center;
              background: #1e1e1e;
              padding: 40px;
              border-radius: 16px;
              max-width: 400px;
              width: 90%;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2 style="color: #ff3b30;">Reiniciando sesión</h2>
            <p>Borrando la sesión de autenticación y reiniciando el bot...</p>
            <p style="color: #a3a3a8;">Redirigiendo en 5 segundos...</p>
          </div>
          <script>
            setTimeout(() => { window.location.href = '/'; }, 5000);
          </script>
        </body>
      </html>
    `);

    console.warn('[HTTP Reset] Peticion de reinicio de sesion autorizada.');
    requestProcessRestart(
      'manual_reset_restart',
      `Reset manual autorizado desde ${requesterAddress}.`,
      { clearAuth: true }
    );
    return;
  }

  res.writeHead(200, htmlHeaders);

  if (latestQrDataUrl) {
    res.end(`
      <html>
        <head>
          <title>Kingdoom Bot - Escanear QR</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="25">
          <style>
            body {
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              background-color: #121212;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              color: #f5f5f7;
            }
            .container {
              text-align: center;
              background: #1e1e1e;
              padding: 40px;
              border-radius: 16px;
              box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
              max-width: 400px;
              width: 90%;
            }
            h2 {
              margin-top: 0;
              color: #f5f5f7;
            }
            .qr-wrapper {
              background: #ffffff;
              padding: 15px;
              border-radius: 12px;
              display: inline-block;
              margin: 20px 0;
            }
            .qr-wrapper img {
              display: block;
              transition: opacity 160ms ease, transform 160ms ease;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Kingdoom Bot</h2>
            <p>Estado actual: <strong id="qr-status-value" style="color: #ffc107;">${escapeHtml(appStatus)}</strong></p>
            <p>Escanea este codigo QR con WhatsApp:</p>
            <div class="qr-wrapper">
              <img id="qr-image" src="${latestQrDataUrl}" alt="Codigo QR de WhatsApp" data-qr-updated-at="${escapeHtml(latestQrUpdatedAt ?? '')}" />
            </div>
            <p id="qr-sync-hint" style="color: #ffc107; font-weight: 500;">La vista se sincroniza sola. Si WhatsApp genera un QR nuevo, esta imagen se reemplazara automaticamente.</p>
            <p id="qr-updated-label" style="color:#a3a3a8;font-size:13px;margin-top:-4px;">Ultima renovacion del QR: ${escapeHtml(formatStatusTimestamp(latestQrUpdatedAt))}</p>
            ${renderStatusMetaHtml()}
          </div>
          ${renderAutoRefreshScript()}
        </body>
      </html>
    `);
  } else {
    res.end(`
      <html>
        <head>
          <title>Kingdoom Bot - Estado</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="25">
          <style>
            body {
              display: flex;
              align-items: center;
              justify-content: center;
              height: 100vh;
              background-color: #121212;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              color: #f5f5f7;
            }
            .container {
              text-align: center;
              background: #1e1e1e;
              padding: 40px;
              border-radius: 16px;
              box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
              max-width: 400px;
              width: 90%;
            }
            h2 {
              margin-top: 0;
              color: #4caf50;
            }
            p {
              color: #a3a3a8;
              font-size: 16px;
              line-height: 1.5;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Kingdoom Bot</h2>
            <p>Estado del sistema: <strong style="color: #4caf50;">${escapeHtml(appStatus)}</strong></p>
            <p>Si la pagina no carga el QR, el bot esta procesando la conexion o ya se conecto exitosamente.</p>
            ${latestPairingCode ? `<p style="color:#ffc107;font-weight:600;">Codigo de vinculacion: <span style="letter-spacing:0.18em;">${escapeHtml(latestPairingCode)}</span></p>` : ''}
            ${renderStatusMetaHtml()}
          </div>
          ${renderAutoRefreshScript()}
        </body>
      </html>
    `);
  }
}).listen(parseInt(PORT, 10), '0.0.0.0', () => {
  console.log(`Servidor web activo en puerto ${PORT}`);
  recordRuntimeEvent('http_listening', `Panel HTTP activo en puerto ${PORT}.`, appStatus);
});

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: authDataPath, rmMaxRetries: 10 }),
  authTimeoutMs: WHATSAPP_AUTH_TIMEOUT_MS,
  takeoverOnConflict: WHATSAPP_TAKEOVER_ON_CONFLICT,
  takeoverTimeoutMs: WHATSAPP_TAKEOVER_TIMEOUT_MS,
  pairWithPhoneNumber: WHATSAPP_PAIR_PHONE_NUMBER
    ? {
        phoneNumber: WHATSAPP_PAIR_PHONE_NUMBER,
        showNotification: WHATSAPP_PAIR_SHOW_NOTIFICATION,
        intervalMs: WHATSAPP_PAIR_INTERVAL_MS,
      }
    : undefined,
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-zygote',
      // '--single-process' removido: es causa conocida de "Protocol error /
      // Target closed / Session closed" con whatsapp-web.js, los mismos errores
      // que disparan los reinicios del contenedor.
      '--disable-extensions',
      '--disable-accelerated-2d-canvas',
    ],
  },
});

client.on('qr', async (qr) => {
  console.log('Escanea este QR:');
  markWhatsappProgress();
  whatsappClientReady = false;
  appStatus = 'Esperando escaneo de codigo QR...';
  latestQrUpdatedAt = new Date().toISOString();
  latestPairingCode = '';
  latestPairingCodeUpdatedAt = null;
  lastLoadingPercent = null;
  qrcode.generate(qr, { small: true });

  try {
    latestQrDataUrl = await qrcodeImage.toDataURL(qr);
    recordRuntimeEvent('qr', 'WhatsApp solicito un nuevo codigo QR.', appStatus);
  } catch (err) {
    console.error('Error generating QR DataURL:', err);
    recordRuntimeEvent('qr_render_error', formatInitializeError(err), appStatus);
  }
});

client.on('code', (code) => {
  markWhatsappProgress();
  whatsappClientReady = false;
  latestQrDataUrl = '';
  latestQrUpdatedAt = null;
  latestPairingCode = String(code ?? '').trim();
  latestPairingCodeUpdatedAt = new Date().toISOString();
  lastLoadingPercent = null;
  recordRuntimeEvent(
    'pairing_code',
    'WhatsApp genero un codigo de vinculacion por telefono.',
    'Esperando vinculacion por codigo...'
  );
});

client.on('authenticated', () => {
  markWhatsappProgress();
  whatsappClientReady = false;
  latestQrDataUrl = '';
  latestQrUpdatedAt = null;
  latestPairingCode = '';
  latestPairingCodeUpdatedAt = null;
  recordRuntimeEvent(
    'authenticated',
    'El telefono acepto la vinculacion. Iniciando sincronizacion del cliente.',
    'Autenticado. Sincronizando WhatsApp...'
  );
});

client.on('loading_screen', (percent, message) => {
  const roundedPercent = Number.isFinite(percent) ? Math.round(percent) : null;
  if (roundedPercent === null || roundedPercent === lastLoadingPercent) {
    return;
  }

  markWhatsappProgress();
  lastLoadingPercent = roundedPercent;
  appStatus = `Sincronizando WhatsApp... ${roundedPercent}%`;

  if (roundedPercent === 100 || roundedPercent <= 5 || roundedPercent % 10 === 0) {
    recordRuntimeEvent(
      'loading_screen',
      `Sincronizacion ${roundedPercent}%${message ? `: ${String(message)}` : ''}`,
      appStatus
    );
  } else {
    persistRuntimeStatus();
  }
});

client.on('ready', async () => {
  markWhatsappProgress();
  whatsappClientReady = true;
  runtimeStatus.restartCount = 0;
  latestQrDataUrl = '';
  latestQrUpdatedAt = null;
  latestPairingCode = '';
  latestPairingCodeUpdatedAt = null;
  lastLoadingPercent = null;
  recordRuntimeEvent(
    'ready',
    authPathPersistent
      ? 'Cliente conectado. La sesion usa almacenamiento persistente.'
      : 'Cliente conectado. La sesion sigue en almacenamiento temporal; si el contenedor reinicia, puede volver a pedir QR.',
    'Conectado a WhatsApp.'
  );

  if (readyBootstrapComplete) {
    recordRuntimeEvent(
      'ready_duplicate',
      'WhatsApp repitio el evento ready; se conserva el runtime ya inicializado.',
      'Conectado a WhatsApp.'
    );
    return;
  }

  console.log('Kingdoom Bot conectado');
  readyBootstrapComplete = true;
  
  try {
    await initMissionTracker();
    console.log('[index.js] Estado de misiones restaurado desde BD.');
  } catch (error) {
    console.error('[index.js] Error al restaurar misiones:', error);
  }

  // --- ESCROW RECOVERY SYSTEM ---
  try {
    const orphanedBets = await getUnresolvedBets(10); // older than 10 mins
    if (orphanedBets && orphanedBets.length > 0) {
      console.log(`[Escrow] Recuperando ${orphanedBets.length} apuestas huerfanas...`);
      for (const bet of orphanedBets) {
        // Resolve bet with the original amount (refund)
        await resolveBet(bet.id, bet.amount);
        
        // Notify player via WhatsApp if we have their phone
        if (bet.players && bet.players.phone) {
          const jid = formatJid(bet.players.phone);
          const msgText = `🔮 *¡Intervención Divina!*\nEl oráculo detectó que tu partida de *${bet.game_type}* se interrumpió abruptamente debido a una falla espacio-temporal.\n\n🪙 Se han devuelto de forma segura *${bet.amount.toLocaleString('es-PY')} oro* a tus reservas.`;
          await client.sendMessage(jid, msgText).catch(err => {
            console.error(`[Escrow] Error al notificar a ${bet.players.phone}:`, err.message);
          });
        }
      }
      console.log(`[Escrow] Apuestas huérfanas recuperadas exitosamente.`);
    }
  } catch (escrowErr) {
    console.error('[index.js] Error al recuperar apuestas del escrow:', escrowErr);
  }
  // ------------------------------

  if (!schedulerStarted) {
    startScheduler(client, () => whatsappClientReady);
    schedulerStarted = true;
  }

  if (!realtimeStarted) {
    startAuctionsRealtime(client);
    realtimeStarted = true;
  }
});

client.on('auth_failure', (message) => {
  console.error('[whatsapp auth_failure]', message);
  whatsappClientReady = false;
  readyBootstrapComplete = false;
  latestQrDataUrl = '';
  latestQrUpdatedAt = null;
  latestPairingCode = '';
  latestPairingCodeUpdatedAt = null;
  lastLoadingPercent = null;
  console.error('La sesión de WhatsApp es invalida o expiro. Se reiniciara con autenticacion limpia.');
  requestProcessRestart(
    'auth_failure_restart',
    `WhatsApp rechazo la sesion actual: ${String(message ?? 'sin detalle')}`,
    { clearAuth: true }
  );
});

client.on('disconnected', (reason) => {
  console.warn('[whatsapp disconnected]', reason);
  const shouldClearAuth = isLogoutDisconnectReason(reason);
  whatsappClientReady = false;
  readyBootstrapComplete = false;
  schedulerStarted = false;
  realtimeStarted = false;
  try {
    clearTreasureTimeouts();
  } catch (e) {
    console.error('Error limpiando timeouts de tesoros', e);
  }
  latestQrDataUrl = '';
  latestQrUpdatedAt = null;
  latestPairingCode = '';
  latestPairingCodeUpdatedAt = null;
  lastLoadingPercent = null;
  if (shouldClearAuth) {
    console.warn('[whatsapp disconnected] Motivo LOGOUT detectado; se descartara la sesion persistida antes de reinicializar.');
  }
  requestProcessRestart(
    'disconnected_restart',
    `WhatsApp se desconecto con motivo: ${String(reason ?? 'sin detalle')}`,
    { clearAuth: shouldClearAuth }
  );
});

client.on('change_state', (state) => {
  console.log('[whatsapp state]', state);
  recordRuntimeEvent(
    'change_state',
    `Nuevo estado interno: ${String(state ?? 'unknown')}`,
    `Estado WhatsApp: ${String(state ?? 'unknown')}`
  );
});

client.on('group_join', async (notification) => {
  try {
    await handleGroupRejoin(notification, client, playerLifecycleConfig);
    await handleGroupWelcome(notification, client, welcomeConfig);
  } catch (error) {
    console.error('[group_join]', error.message);
  }
});

client.on('group_leave', async (notification) => {
  try {
    await handleGroupLeave(notification, client, playerLifecycleConfig);
  } catch (error) {
    console.error('[group_leave]', error.message);
  }
});



const activityCache = new Map();
const processedMessages = new Set(); // deduplication cache

client.on('message', async (msg) => {
  if (msg.fromMe || msg.isStatus) return;

  // Deduplication check
  if (msg.id && msg.id._serialized) {
    if (processedMessages.has(msg.id._serialized)) {
      return; // Already processed
    }
    processedMessages.add(msg.id._serialized);
    
    // Prevent memory leak by keeping only the last 1000 messages
    if (processedMessages.size > 1000) {
      const firstItem = processedMessages.values().next().value;
      processedMessages.delete(firstItem);
    }
  }

  const text = typeof msg.body === 'string' ? msg.body.trim() : '';
  const sender = msg.author || msg.from;

  // Intercept replies (Blackjack, Tesoros, etc.)
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      if (quoted) {
        const quotedId = quoted.id._serialized;

        // Blackjack session replies
        if (activeSessions.has(quotedId)) {
          const session = activeSessions.get(quotedId);
          
          let isAllowed = false;
          if (session.isMultiplayer) {
            isAllowed = session.players.some(p => p.playerPhone === normalizePhone(sender));
          } else {
            isAllowed = sender === session.playerPhone;
          }

          if (isAllowed) {
            const replyText = await handleBlackjackReply(msg, session, quotedId, client);
            if (replyText) {
              await msg.reply(replyText);
            }
            return;
          } else {
            // Ignore replies from other players to prevent interference
            return;
          }
        }

        // Tesoro Errante replies
        if (activeTreasures.has(quotedId)) {
          const treasure = activeTreasures.get(quotedId);
          await handleTreasureReply(msg, treasure, quotedId, client);
          return;
        }
      }
    } catch (e) {
      console.error('[Reply Intercept Error]', e);
    }
  }

  if (isEligibleRoleplayActivityMessage(msg, text)) {
    const roleplayPhone = normalizePhone(sender);
    const lastTouchedAt = roleplayActivityCache.get(roleplayPhone) ?? 0;
    const nowMs = Date.now();

    if (!lastTouchedAt || nowMs - lastTouchedAt >= ROLEPLAY_ACTIVITY_TOUCH_INTERVAL_MS) {
      try {
        const roleplayResult = await markRoleplayActivityForPhone(sender, {
          actor: 'bot:roleplay_group_message',
          groupJid: msg.from,
        });
        roleplayActivityCache.set(roleplayPhone, nowMs);

        for (const unlockedPlayer of roleplayResult.unlockedPlayers ?? []) {
          const unlockedPhone = normalizePhone(unlockedPlayer.phone ?? roleplayPhone);
          if (!unlockedPhone) continue;

          try {
            await client.sendMessage(
              formatJid(unlockedPhone),
              `✅ *Acceso restaurado*\nHas vuelto a rolear en el grupo principal del reino.\nLos minijuegos, la economia y las consultas recreativas quedaron habilitados otra vez.`
            );
          } catch (unlockNotifyError) {
            console.error('[roleplay unlock notify]', unlockNotifyError);
          }
        }
      } catch (roleplayError) {
        console.error('[roleplay activity]', roleplayError?.message ?? roleplayError);
      }
    }
  }

  // 0. GM Mission Tracker (Roleplay messages usually don't have ! prefix)
  const trackerResult = processTrackerMessage(text, sender);
  if (trackerResult?.missionClosed) {
    const finalResult = trackerResult.finalState?.resultado ?? 'resuelta';
    const finalReason = trackerResult.finalState?.motivo
      ? ` Motivo: ${trackerResult.finalState.motivo}`
      : '';
    await msg.reply(
      `La mision *${trackerResult.shortId}* ya fue marcada como *${finalResult}*.${finalReason}`
    );
    return;
  }

  if (trackerResult && trackerResult.shouldTriggerGM) {
    let gmVisibleSendAttempted = false;
    try {
      const gmPrompt = buildGMPrompt();
      const gmUserPayload = buildGMUserPayload(
        trackerResult.missionTitle,
        trackerResult.missionInstructions,
        trackerResult.context,
        trackerResult.missionGmConfig,
        trackerResult.gmRuntimeState
      );

      await msg.reply('*El Game Master esta escribiendo la narrativa...*');
      await sleep(getRandomDelayMs(800, 1500));

      const history = [{ role: 'user', content: gmUserPayload }];
      let aiResponse = await askKingdoomAI(history, gmPrompt, {
        maxEstimatedInputTokens: 6000,
        maxOutputTokens: 2048,
      });

      let responseAssessment = assessGMResponse(aiResponse);
      if (responseAssessment.needsRepair) {
        console.warn('[GM Tracker] La respuesta del GM parece truncada o sin ESTADO_MISION. Intentando una reparacion automatica.');
        try {
          const repairHistory = [
            { role: 'user', content: gmUserPayload },
            { role: 'assistant', content: aiResponse },
            {
              role: 'user',
              content: 'La respuesta anterior del Game Master quedo truncada o incompleta. Reescribe la intervencion completa desde el inicio de esa misma respuesta, manteniendo continuidad exacta, sin reiniciar la mision, sin contradecir lo ya narrado y terminando obligatoriamente con [ESTADO_MISION].',
            },
          ];

          aiResponse = await askKingdoomAI(repairHistory, gmPrompt, {
            maxEstimatedInputTokens: 6000,
            maxOutputTokens: 2048,
          });
          responseAssessment = assessGMResponse(aiResponse);
        } catch (repairErr) {
          console.warn('[GM Tracker] La reparacion automatica del GM tambien fallo:', repairErr?.message ?? repairErr);
        }
      }

      if (responseAssessment.needsRepair) {
        console.warn('[GM Tracker] Se aplicara un cierre de seguridad para preservar continuidad en la mision.');
        aiResponse = buildFallbackCompletedGMResponse(aiResponse);
        responseAssessment = assessGMResponse(aiResponse);
      }

      const resolution = registerGMResponse(trackerResult.instanceId, aiResponse);
      const visibleResponse = responseAssessment.visibleResponse || buildVisibleGMResponse(aiResponse);
      gmVisibleSendAttempted = true;
      await client.sendMessage(msg.from, visibleResponse);

      if (resolution.autoClosed && resolution.missionState) {
        await client.sendMessage(
          msg.from,
          `*Resultado registrado:* la mision *${trackerResult.shortId}* queda marcada como *${resolution.missionState.resultado}*.`
        );
      }
    } catch (err) {
      console.error('[GM Tracker Error]', err);
      if (gmVisibleSendAttempted && isPuppeteerDeliveryAmbiguousError(err)) {
        console.warn('[GM Tracker] WhatsApp reporto un error ambiguo despues de intentar enviar la narrativa; se omite el aviso de error para evitar duplicar/confundir al rol.');
        return;
      }
      await msg.reply('Error al generar la narrativa del GM. Intenten de nuevo mas tarde o reporten a un administrador.');
    }
  }

  const { command, body, hasPrefix } = parseCommand(text);
  const isDirectChat = !String(msg.from ?? '').endsWith('@g.us');
  const shouldTraceMessageFlow = hasPrefix || isDirectChat;
  const commandLabel = hasPrefix && command ? `!${command}` : '(sin comando)';
  const messageSummary = summarizeTextForLog(text, 96);
  let slowMessageTimer = null;

  if (shouldTraceMessageFlow) {
    console.log(
      `[message inbound] chat=${msg.from} sender=${sender} type=${msg.type ?? 'unknown'} command=${commandLabel} body="${messageSummary || '[vacio]'}"`
    );
    recordRuntimeEvent(
      'message_inbound',
      `Chat ${msg.from} desde ${sender}: ${commandLabel}${messageSummary ? ` :: ${messageSummary}` : ''}`,
      hasPrefix ? `Procesando ${commandLabel}...` : appStatus
    );
  }

  if (hasPrefix) {
    slowMessageTimer = setTimeout(() => {
      console.warn(
        `[message slow] chat=${msg.from} sender=${sender} command=${commandLabel} supero ${COMMAND_PROCESSING_WARN_MS}ms`
      );
      recordRuntimeEvent(
        'message_processing_slow',
        `${commandLabel} sigue en curso despues de ${COMMAND_PROCESSING_WARN_MS}ms en ${msg.from}.`,
        `Procesando ${commandLabel}...`
      );
    }, COMMAND_PROCESSING_WARN_MS);

    if (typeof slowMessageTimer.unref === 'function') {
      slowMessageTimer.unref();
    }
  }

  let senderPlayersPromise = null;
  const getSenderPlayers = () => {
    if (!senderPlayersPromise) {
      senderPlayersPromise = getPlayersByPhone(sender);
    }
    return senderPlayersPromise;
  };

  const nowMs = Date.now();
  if (!activityCache.has(sender) || (nowMs - activityCache.get(sender)) > 5 * 60 * 1000) {
    activityCache.set(sender, nowMs);
    getSenderPlayers().then((players) => {
      players.forEach((player) => {
        if (player && player.id) {
          touchPlayerActivity(player.id).catch(console.error);
        }
      });
    }).catch(console.error);
  }

  // Analytics: Log command usage asynchronously
  if (hasPrefix && command) {
    botStateSupabase
      .from('bot_command_logs')
      .insert({ player_phone: sender, command: command })
      .then(({ error }) => {
        if (error) console.error('[CommandLog] Error:', error.message);
      })
      .catch((err) => {
        console.error('[CommandLog] Catch:', err.message);
      });
  }

  const checkIsAdmin = async (user) => {
    if (isAdminUser(user)) return true;
    try {
      const players = user === sender ? await getSenderPlayers() : await getPlayersByPhone(user);
      return players.some((player) => player?.is_admin === true);
    } catch (err) {
      console.error('[checkIsAdmin] Error checking DB:', err);
      return false;
    }
  };

  const ADMIN_COMMANDS = ['grant', 'quitar', 'stats', 'ban', 'registrar', 'verificarnumero', 'desvincular', 'add', 'remove', 'admin', 'censo', 'fichas', 'pendientes', 'pendiente', 'purga', 'actividad', 'inactivos', 'groupid', 'grupos', 'grupoactual', 'staff', 'bitacora', 'data', 'misionstart', 'misioneson', 'misionoff'];
  const PRIVILEGED_COMMANDS = ['misioncompleta', 'faltasgrupo', 'fichasrecicladas', 'asignarficha', 'rolestado', 'rolbloquear', 'roldesbloquear', 'rolgracia', 'rolforzaractividad'];
  const isMarketSessionActive = !!getMarketForgeSession(msg.from, sender);
  const isMarketCommand = hasPrefix && (command === 'forjaritem' || (command === 'mercado' && body.toLowerCase().startsWith('crear')));
  const isPossibleAdminCmd = hasPrefix && (ADMIN_COMMANDS.includes(command) || PRIVILEGED_COMMANDS.includes(command));
  const isRoleplayBlockedCommand = hasPrefix && ROLEPLAY_BLOCKED_COMMANDS.has(command);
  const isRestrictedMainGroupMinigame =
    hasPrefix &&
    msg.from === RESTRICTED_MINIGAME_GROUP_ID &&
    RESTRICTED_MINIGAME_COMMANDS.has(command);

  let isAdmin = false;
  let isStaff = false;
  let isPrivileged = false;

  if (isMarketSessionActive || isMarketCommand || isPossibleAdminCmd || isRestrictedMainGroupMinigame || isRoleplayBlockedCommand) {
    isAdmin = await checkIsAdmin(sender);
    isStaff = isStaffUser(sender);
    isPrivileged = isAdmin || isStaff;
  }

  let reply = '';

  const wrapMsg = (originalMsg, newBody) => {
    const wrapped = Object.create(originalMsg);
    wrapped.body = newBody;
    return wrapped;
  };

  try {
    const forgeReply = await handleMarketForgeConversation(msg, {
      sender,
      actorName: 'Staff',
      isAdmin,
      isPrivileged,
    });

    let isRoleplayLocked = false;
    if (isRoleplayBlockedCommand && !isPrivileged) {
      const activePlayer = await getPlayer(sender);
      const roleplayAccess = activePlayer?.id
        ? await getPlayerRoleplayAccess(activePlayer.id).catch((error) => {
            console.error('[roleplay gate]', error?.message ?? error);
            return null;
          })
        : null;

      if (isRoleplayAccessCurrentlyLocked(roleplayAccess)) {
        reply = buildRoleplayLockedReply(command);
        isRoleplayLocked = true;
      }
    }

    if (!isRoleplayLocked) {
      if (forgeReply) {
        reply = forgeReply;
      } else if (isRestrictedMainGroupMinigame && !isPrivileged) {
        const lockKey = `${RESTRICTED_MINIGAME_SCOPE_KEY}:${normalizePhone(sender)}`;
        reply = await runRestrictedGroupSerial(lockKey, async () => {
          const player = await getPlayer(sender);
          const violations = player?.id
            ? await getRestrictedGroupCommandViolationsForDay(player.id, RESTRICTED_MINIGAME_SCOPE_KEY)
            : [];
          const desiredPenalty = getRestrictedCommandPenalty(violations.length);
          const availableGold = Math.max(0, Number(player?.gold ?? 0));
          const appliedPenalty = Math.min(availableGold, desiredPenalty);

          if (player?.id) {
            if (appliedPenalty > 0) {
              await updateGold(player.id, -appliedPenalty);
            }

            await recordRestrictedGroupCommandViolation({
              playerId: player.id,
              scopeKey: RESTRICTED_MINIGAME_SCOPE_KEY,
              commandName: command,
              penaltyGold: appliedPenalty,
            });
          }

          try {
            await client.sendMessage(
              formatJid(normalizePhone(sender)),
              buildRestrictedGroupPrivateReply(command)
            );
          } catch (privateError) {
            console.error('[restricted command private notify]', privateError);
          }

          if (desiredPenalty <= 0) {
            return buildRestrictedGroupWarningReply(command);
          }

          const availableGoldAfter = Math.max(0, availableGold - appliedPenalty);
          return buildRestrictedGroupPenaltyReply(command, desiredPenalty, appliedPenalty, availableGoldAfter);
        });
      } else if (!hasPrefix) {
        return;
      } else if ((isAdmin && ADMIN_COMMANDS.includes(command)) || (isPrivileged && PRIVILEGED_COMMANDS.includes(command))) {
        reply = await handleAdminCommand(
          wrapMsg(msg, ensurePrefixedBody(command, text, body)),
          client
        );
      } else if (command === 'registrar') {
        reply = 'El comando *!registrar* esta restringido unicamente a los Administradores del Reino.';
      } else if (command === 'dados') {
        reply = await handleDados(wrapMsg(msg, ensurePrefixedBody(command, text, body)));
      } else if (command === 'cofre') {
        reply = await handleCofre(wrapMsg(msg, ensurePrefixedBody(command, text, body)));
      } else if (command === 'trampa') {
        reply = await handleTrampa(wrapMsg(msg, ensurePrefixedBody(command, text, body)));
      } else if (command === 'oraculo') {
        reply = await handleOraculo(wrapMsg(msg, ensurePrefixedBody(command, text, body)));
      } else if (command === '21') {
        reply = await handleBlackjack(wrapMsg(msg, ensurePrefixedBody(command, text, body)), client);
      } else if (command === 'apk' || command === 'app') {
        try {
          await sendLatestApk({
            sendMessage: (...args) => client.sendMessage(msg.from, ...args),
          });
        } catch (e) {
          reply = `⚠️ Hubo un error al intentar descargar el APK desde el repositorio: ${e.message}`;
        }
      } else if (
        [
          'oro',
          'gold',
          'perfil',
          'estado',
          'vinculo',
          'nuevo',
          'verificar',
          'ranking',
          'top',
          'ricos',
          'fortunas',
          'mercado',
          'item',
          'mision',
          'evento',
          'reino',
          'resumen',
          'ayuda',
          'help',
          'subasta',
          'subastas',
          'pujar',
          'puja',
          'retirarse',
        ].includes(command)
      ) {
        reply = await handlePlayerMessage(wrapMsg(msg, ensurePrefixedBody(command, text, body)));
      } else {
        reply = await handlePlayerMessage(msg);
      }
    }

    if (reply) {
      await sendBotText(msg, reply, { context: command || 'message' });
      if (slowMessageTimer) {
        clearTimeout(slowMessageTimer);
        slowMessageTimer = null;
      }
      if (shouldTraceMessageFlow) {
        console.log(
          `[message reply] chat=${msg.from} sender=${sender} command=${commandLabel} chars=${String(reply).length}`
        );
        recordRuntimeEvent(
          'message_replied',
          `${commandLabel} respondido en ${msg.from} para ${sender}.`,
          hasPrefix ? `Respuesta enviada para ${commandLabel}.` : appStatus
        );
      }
    }
  } catch (err) {
    if (slowMessageTimer) {
      clearTimeout(slowMessageTimer);
      slowMessageTimer = null;
    }
    if (shouldTraceMessageFlow) {
      recordRuntimeEvent(
        'message_failed',
        `${commandLabel} fallo en ${msg.from}: ${formatInitializeError(err)}`,
        hasPrefix ? `Fallo ${commandLabel}.` : appStatus
      );
    }
    console.error('Error:', err);
    await sendEmergencyText(msg, 'El reino esta en llamas... intenta de nuevo en un momento.', 'message_error');
  } finally {
    if (slowMessageTimer) {
      clearTimeout(slowMessageTimer);
    }
  }
});

async function initializeClientWithRetry() {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    for (let attempt = 1; attempt <= WHATSAPP_INIT_MAX_RETRIES; attempt += 1) {
      try {
        const removedLocks = cleanupStaleChromiumLocks(authDataPath);
        if (removedLocks.length > 0) {
          console.warn(`[whatsapp init] Locks huerfanos removidos: ${removedLocks.join(', ')}`);
          recordRuntimeEvent(
            'chromium_locks_cleaned',
            `Se removieron ${removedLocks.length} lock(s) huerfanos antes del intento ${attempt}.`,
            'Preparando sesion persistente...'
          );
        }
        console.log(
          `[whatsapp init] Intento ${attempt}/${WHATSAPP_INIT_MAX_RETRIES} hacia web.whatsapp.com`
        );
        markWhatsappProgress();
        recordRuntimeEvent(
          'initialize_attempt',
          `Intento ${attempt}/${WHATSAPP_INIT_MAX_RETRIES} hacia web.whatsapp.com.`,
          'Conectando a WhatsApp...'
        );
        await client.initialize();
        return;
      } catch (err) {
        const formattedError = formatInitializeError(err);
        const isLastAttempt = attempt >= WHATSAPP_INIT_MAX_RETRIES;
        console.error(
          `[whatsapp init] Fallo intento ${attempt}/${WHATSAPP_INIT_MAX_RETRIES}: ${formattedError}`
        );
        recordRuntimeEvent(
          'initialize_failure',
          `Fallo intento ${attempt}/${WHATSAPP_INIT_MAX_RETRIES}: ${formattedError}`,
          'Fallo al conectar con WhatsApp.'
        );

        if (client.pupBrowser) {
          try {
            console.log('[whatsapp init] Cerrando navegador huerfano para liberar el bloqueo de sesion...');
            await client.pupBrowser.close();
          } catch (closeErr) {
            console.error('[whatsapp init] Error al cerrar el navegador:', closeErr);
          }
          client.pupBrowser = null;
        }

        if (isLastAttempt) {
          if (WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE) {
            console.error(
              '[whatsapp init] Se agotaron los reintentos de inicializacion. El entorno permite borrar autenticacion y reintentar en caliente...'
            );
            recordRuntimeEvent(
              'initialize_failed_reset_auth',
              `Se agotaron los reintentos y WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE esta activo. Error final: ${formattedError}`,
              'Fallo grave de inicializacion. Borrando sesion y reintentando...'
            );
            try {
              if (fs.existsSync(authDataPath)) {
                fs.rmSync(authDataPath, { recursive: true, force: true });
                console.log('[whatsapp init] Carpeta de autenticacion borrada.');
              }
            } catch (cleanErr) {
              console.error('[whatsapp init] Error al borrar la carpeta de autenticacion:', cleanErr);
            }
          } else {
            console.error(
              '[whatsapp init] Se agotaron los reintentos de inicializacion. Se hara una recuperacion interna conservando autenticacion.'
            );
            recordRuntimeEvent(
              'initialize_failed_restart',
              `Se agotaron los reintentos, pero la autenticacion se conserva. Error final: ${formattedError}`,
              'Fallo de inicializacion. Reintentando sin borrar sesion...'
            );
          }
          const reconnectDelayMs = calculateReconnectDelayMs(
            runtimeStatus.restartCount + 1,
            WHATSAPP_INIT_RETRY_DELAY_MS,
            WHATSAPP_RECONNECT_MAX_DELAY_MS
          );
          requestProcessRestart(
            'initialize_exhausted_restart',
            `Se agotaron ${WHATSAPP_INIT_MAX_RETRIES} intento(s). Error final: ${formattedError}`,
            {
              clearAuth: WHATSAPP_RESET_AUTH_ON_LAST_INIT_FAILURE,
              delayMs: reconnectDelayMs,
            }
          );
          return;
        }

        const nextDelayMs = WHATSAPP_INIT_RETRY_DELAY_MS * attempt;
        console.log(
          `[whatsapp init] Reintentando en ${Math.round(nextDelayMs / 1000)}s...`
        );
        await sleep(nextDelayMs);
      }
    }
  })().finally(() => {
    initializePromise = null;
  });

  return initializePromise;
}

process.on('unhandledRejection', (reason) => {
  const formattedError = formatInitializeError(reason);
  console.error(`[process unhandledRejection] ${formattedError}`);
  
  if (
    formattedError.includes('auth timeout') || 
    formattedError.includes('ERR_TIMED_OUT') || 
    formattedError.includes('Target closed') || 
    formattedError.includes('Session closed') ||
    formattedError.includes('Protocol error')
  ) {
    console.error('El cliente de WhatsApp esta en un estado irrecuperable. Reiniciando el contenedor...');
    requestProcessRestart('unhandled_rejection_restart', formattedError);
  }
});

process.on('uncaughtException', (error) => {
  const formattedError = formatInitializeError(error);
  console.error(`[process uncaughtException] ${formattedError}`);
  
  if (
    formattedError.includes('auth timeout') || 
    formattedError.includes('ERR_TIMED_OUT') || 
    formattedError.includes('Target closed') || 
    formattedError.includes('Session closed') ||
    formattedError.includes('Protocol error')
  ) {
    console.error('El cliente de WhatsApp esta en un estado irrecuperable. Reiniciando el contenedor...');
    requestProcessRestart('uncaught_exception_restart', formattedError);
  }
});

async function closeWhatsappBrowser() {
  if (!client?.pupBrowser) return;

  try {
    await Promise.race([
      client.destroy(),
      sleep(WHATSAPP_SHUTDOWN_TIMEOUT_MS).then(() => {
        throw new Error(`Timeout cerrando Chromium tras ${WHATSAPP_SHUTDOWN_TIMEOUT_MS}ms`);
      }),
    ]);
  } catch (error) {
    console.warn('[whatsapp shutdown]', formatInitializeError(error));
  } finally {
    client.pupBrowser = null;
    client.pupPage = null;
  }
}

function requestProcessRestart(event, detail, options = {}) {
  if (restartRequested || shutdownRequested) return false;

  restartRequested = true;
  whatsappClientReady = false;
  const clearAuth = options.clearAuth === true;
  const delayMs = Math.max(WHATSAPP_RESTART_GRACE_MS, Number(options.delayMs) || 0);
  runtimeStatus.restartCount += 1;
  recordRuntimeEvent(
    event,
    `${detail} Recuperacion ordenada en ${Math.round(delayMs / 1000)}s${clearAuth ? '; la autenticacion se limpiara despues de cerrar Chromium' : '; la autenticacion se conservara'}.`,
    'Recuperando conexion de WhatsApp...'
  );

  setTimeout(async () => {
    try {
      await closeWhatsappBrowser();
      if (clearAuth) {
        clearAuthDataPath(event);
      }
      restartRequested = false;
      readyBootstrapComplete = false;
      latestQrDataUrl = '';
      latestQrUpdatedAt = null;
      latestPairingCode = '';
      latestPairingCodeUpdatedAt = null;
      lastLoadingPercent = null;
      recordRuntimeEvent(
        'restart_reinitialize',
        `Se lanzara una nueva inicializacion interna tras el evento ${event}.`,
        'Reiniciando cliente de WhatsApp...'
      );
      await initializeClientWithRetry();
    } catch (error) {
      restartRequested = false;
      const formattedError = formatInitializeError(error);
      console.error(`[whatsapp recovery] ${formattedError}`);
      recordRuntimeEvent(
        'restart_reinitialize_failure',
        `La recuperacion interna fallo: ${formattedError}`,
        'Error al recuperar WhatsApp.'
      );
    }
  }, delayMs);

  return true;
}

async function shutdownForSignal(signal) {
  if (shutdownRequested) return;
  shutdownRequested = true;
  whatsappClientReady = false;
  recordRuntimeEvent(
    'process_shutdown',
    `El contenedor recibio ${signal}; cerrando Chromium antes de salir.`,
    'Cerrando bot de forma segura...'
  );
  await closeWhatsappBrowser();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdownForSignal('SIGTERM'));
process.once('SIGINT', () => void shutdownForSignal('SIGINT'));

void initializeClientWithRetry();
