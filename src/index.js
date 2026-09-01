import dns from 'node:dns';
try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch {}

import http from 'http';
import fs from 'fs';
import pkg from 'whatsapp-web.js';
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
import { isOwner, isAdminUser, isStaffUser, normalizePhone, formatJid } from './adminStore.js';
import {
  canRunAdminCommand,
  isKnownAdminCommand,
} from './adminCommands.js';
import { processTrackerMessage, buildGMPrompt, buildGMUserPayload, registerGMResponse, buildVisibleGMResponse, assessGMResponse, buildFallbackCompletedGMResponse, initMissionTracker } from './gmTracker.js';
import { askKingdoomAI } from './ai.js';
import { handleMarketForgeConversation } from './handlers/marketForge.js';
import {
  activeSessions,
  findBlackjackReplySessionKey,
  handleBlackjack,
  handleBlackjackReply,
  isBlackjackBoardText,
  isBlackjackReplyAction,
} from './handlers/blackjack.js';
import {
  activeTreasures,
  buildTreasureClaimFeedback,
  clearTreasureTimeouts,
  handleTreasureReply,
  isTreasureAnnouncementText,
  isTreasureClaimText,
} from './handlers/treasure.js';
import { findColosseumBetTargetByQuotedId } from './colosseumStore.js';
import { handleApostarColiseo } from './handlers/colosseumHandler.js';
import { getMarketForgeSession } from './marketForgeStore.js';
import { startAuctionsRealtime } from './handlers/auctionsRealtime.js';
import { findActiveQuotedMessageKey, safeGetQuotedDetails } from './targetResolver.js';
import {
  ensureDir,
  ensureParentDir,
  getAuthDataPath,
  getAuthFilePath,
  getPersistenceMode,
  getRemoteAuthCachePath,
  getRemoteAuthStorePath,
  getRuntimeStatusFilePath,
  isAuthPathLikelyPersistent,
} from './runtimePaths.js';
import {
  calculateReconnectDelayMs,
  classifyWhatsappRuntimeError,
  cleanupStaleChromiumLocks,
  createReconnectAudit,
  isTransientWhatsappState,
  recordPersistenceBoot,
} from './whatsappRecovery.js';
import { sanitizeLogText } from './logSanitizer.js';
import {
  WHATSAPP_HEALTH_STATE,
  chooseFunctionalRecoveryAction,
  createWhatsappHealthTracker,
  probeWhatsappClient,
} from './whatsappHealth.js';
import { ResilientRemoteAuth, VersionedFileRemoteAuthStore } from './remoteAuth.js';
import { decorateCommandReply, heraldCard, heraldStat } from './formatting.js';
import { isLidWhatsAppId, resolveMessageSenderPhone } from './whatsappIdentity.js';
import { hasQuotedMessageMetadata } from './whatsappDelivery.js';

const Client = pkg.Client || pkg.default?.Client || pkg;
const LocalAuth = pkg.LocalAuth || pkg.default?.LocalAuth;
const Message = pkg.Message || pkg.default?.Message;

function createMessageView(originalMsg, overrides = {}) {
  const wrapped = Object.create(originalMsg);
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(wrapped, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value,
    });
  }
  return wrapped;
}

// monkey-patch reply to prevent silent failures with @lid senders or long text
if (Message?.prototype) {
  const originalReply = Message.prototype.reply;
  Message.prototype.reply = async function (content, chatId, options = {}) {
    const sender = this.author || this.from;
    const isLid = String(sender).endsWith('@lid');
    const isLong = typeof content === 'string' && content.length > 600;

    if (isLid || isLong) {
      // Send directly without quote to prevent silent drop/error
      return this.client.sendMessage(chatId || this.from, content, options);
    }

    try {
      return await originalReply.call(this, content, chatId, {
        ignoreQuoteErrors: true,
        ...options,
      });
    } catch (err) {
      console.warn('[Message.reply patch] Quoted reply failed; falling back to direct send.', err.message ?? err);
      return this.client.sendMessage(chatId || this.from, content, options);
    }
  };
}

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
const WHATSAPP_READY_HEALTH_FAILURE_LIMIT = Math.max(
  2,
  Number.parseInt(process.env.WHATSAPP_READY_HEALTH_FAILURE_LIMIT ?? '3', 10) || 3
);
const WHATSAPP_READY_HEALTH_TIMEOUT_MS = Math.max(
  3000,
  Number.parseInt(process.env.WHATSAPP_READY_HEALTH_TIMEOUT_MS ?? '10000', 10) || 10000
);
const WHATSAPP_HEALTH_STABILITY_MS = Math.max(
  30000,
  Number.parseInt(process.env.WHATSAPP_HEALTH_STABILITY_MS ?? '60000', 10) || 60000
);
const WHATSAPP_BRIDGE_EVENT_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.WHATSAPP_BRIDGE_EVENT_TIMEOUT_MS ?? '10000', 10) || 10000
);
const WHATSAPP_HEALTH_RECOVERY_WINDOW_MS = Math.max(
  15 * 60 * 1000,
  Number.parseInt(process.env.WHATSAPP_HEALTH_RECOVERY_WINDOW_MS ?? '3600000', 10) || 3600000
);
const WHATSAPP_HEALTH_RECOVERY_RESET_MS = Math.max(
  5 * 60 * 1000,
  Number.parseInt(process.env.WHATSAPP_HEALTH_RECOVERY_RESET_MS ?? '600000', 10) || 600000
);
const WHATSAPP_HEALTH_REATTACH_TIMEOUT_MS = Math.max(
  30000,
  Number.parseInt(process.env.WHATSAPP_HEALTH_REATTACH_TIMEOUT_MS ?? '60000', 10) || 60000
);
const WHATSAPP_ACTIVE_PRESENCE_PROBE =
  String(process.env.WHATSAPP_ACTIVE_PRESENCE_PROBE ?? 'true').trim().toLowerCase() !== 'false';
const WHATSAPP_ACTIVE_NETWORK_PROBE_INTERVAL_MS = Math.max(
  60000,
  Number.parseInt(process.env.WHATSAPP_ACTIVE_NETWORK_PROBE_INTERVAL_MS ?? '120000', 10) || 120000
);
const WHATSAPP_TRANSIENT_STATE_GRACE_MS = Math.max(
  60000,
  Number.parseInt(process.env.WHATSAPP_TRANSIENT_STATE_GRACE_MS ?? '180000', 10) || 180000
);
const WHATSAPP_REMOTE_AUTH_BACKUP_INTERVAL_MS = Math.max(
  60000,
  Number.parseInt(process.env.WHATSAPP_REMOTE_AUTH_BACKUP_INTERVAL_MS ?? '300000', 10) || 300000
);
const WHATSAPP_REMOTE_AUTH_BACKUP_TIMEOUT_MS = Math.max(
  10000,
  Number.parseInt(process.env.WHATSAPP_REMOTE_AUTH_BACKUP_TIMEOUT_MS ?? '30000', 10) || 30000
);
const WHATSAPP_REMOTE_AUTH_KEEP_SNAPSHOTS = Math.max(
  2,
  Number.parseInt(process.env.WHATSAPP_REMOTE_AUTH_KEEP_SNAPSHOTS ?? '3', 10) || 3
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
const isHuggingFaceSpace = Boolean(
  process.env.SPACE_ID ||
  process.env.HF_SPACE_ID ||
  process.env.SPACE_HOST ||
  process.env.SPACE_AUTHOR_NAME ||
  String(process.env.SYSTEM ?? '').trim().toLowerCase() === 'spaces'
);
const whatsappAuthStrategyMode = String(
  process.env.WHATSAPP_AUTH_STRATEGY ?? (isHuggingFaceSpace ? 'remote' : 'local')
).trim().toLowerCase();
if (!['local', 'remote'].includes(whatsappAuthStrategyMode)) {
  throw new Error('WHATSAPP_AUTH_STRATEGY must be local or remote');
}
const authDataPath = getAuthDataPath();
const authSessionPath = getAuthFilePath('session');
const authPersistenceMarkerPath = getAuthFilePath('.kingdoom-persistence.json');
const remoteAuthCachePath = getRemoteAuthCachePath();
const remoteAuthStorePath = getRemoteAuthStorePath();
const chromiumAuthDataPath = whatsappAuthStrategyMode === 'remote'
  ? remoteAuthCachePath
  : authDataPath;
const chromiumSessionDirName = whatsappAuthStrategyMode === 'remote'
  ? 'RemoteAuth-kingdoom-bot'
  : 'session';
const runtimeStatusFilePath = getRuntimeStatusFilePath();
const persistenceMode = getPersistenceMode();
const authPathPersistent = isAuthPathLikelyPersistent(
  whatsappAuthStrategyMode === 'remote' ? remoteAuthStorePath : authDataPath
);
const currentBootAt = new Date().toISOString();

ensureDir(authDataPath);
ensureParentDir(runtimeStatusFilePath);
if (whatsappAuthStrategyMode === 'remote') {
  ensureDir(remoteAuthCachePath);
  ensureDir(remoteAuthStorePath);
}
const authPersistenceEvidence = recordPersistenceBoot(authPersistenceMarkerPath, {
  persistent: authPathPersistent,
  currentBootAt,
});
if (authPersistenceEvidence.error) {
  console.error('[runtime persistence]', sanitizeLogText(authPersistenceEvidence.error));
}
console.log(
  `[runtime] authStrategy=${whatsappAuthStrategyMode} authDataPath=${authDataPath} persistenceMode=${persistenceMode} persistent=${authPathPersistent} evidence=${authPersistenceEvidence.status}`
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
let qrWaitingEpisodeActive = false;
let appStatus = 'Inicializando servidor...';
let whatsappClientReady = false;
let lastWhatsappProgressAt = Date.now();
let lastWhatsappState = null;
let lastWhatsappStateCheckedAt = null;
let whatsappStateFailureCount = 0;
let whatsappStateCheckError = '';
let whatsappStateCheckInFlight = false;
let transientWhatsappStateStartedAt = null;
let transientWhatsappStateLogged = '';
let authenticatedEventSeen = false;
let lastReadyDuplicateLoggedAt = 0;
const welcomeConfig = buildWelcomeConfig();
const playerLifecycleConfig = buildPlayerLifecycleConfig();
let schedulerStarted = false;
let realtimeStarted = false;
let readyBootstrapComplete = false;
let restartRequested = false;
let restartCanBeCancelledOnConnected = false;
let restartClearAuthRequested = false;
let restartClearAuthEvent = '';
let shutdownRequested = false;
let initializePromise = null;
let functionalHealthReattachAttempted = false;
let functionalHealthRecoveryInFlight = false;
let lastActiveNetworkProbeAt = 0;
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

function setBoundedMap(map, key, value, maxSize = 1000) {
  map.set(key, value);
  if (map.size > maxSize) {
    const firstKey = map.keys().next().value;
    map.delete(firstKey);
  }
}

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
  return heraldCard('Comando fuera de lugar', [
    `El comando *!${commandName}* no puede usarse en este grupo principal.`,
    'Por favor envia mensaje al privado para continuar con este comando.',
    heraldStat('Sancion', 'Advertencia gratuita de hoy'),
  ], { icon: '⚠️' });
}

function buildRestrictedGroupPenaltyReply(commandName, desiredPenalty, appliedPenalty, availableGoldAfter) {
  const baseLines = [
    `El comando *!${commandName}* no puede usarse en este grupo principal.`,
    'Por favor envia mensaje al privado para continuar con este comando.',
  ];

  if (appliedPenalty <= 0) {
    baseLines.push(
      heraldStat('Multa prevista', `${formatGoldAmount(desiredPenalty)} oro`),
      'No habia saldo disponible para realizar el descuento.'
    );
    return heraldCard('Reincidencia sancionada', baseLines, { icon: '⛔' });
  }

  if (appliedPenalty < desiredPenalty) {
    baseLines.push(heraldStat('Multa aplicada', `${formatGoldAmount(appliedPenalty)} oro · todo el saldo disponible`));
  } else {
    baseLines.push(heraldStat('Multa aplicada', `${formatGoldAmount(appliedPenalty)} oro`));
  }

  baseLines.push(heraldStat('Oro restante', formatGoldAmount(availableGoldAfter)));
  return heraldCard('Reincidencia sancionada', baseLines, { icon: '⛔' });
}

function buildRestrictedGroupPrivateReply(commandName) {
  return heraldCard('Continua por privado', [
    `*!${commandName}* no se usa en el grupo principal del reino.`,
    'Reenvia aqui ese comando por privado y el bot lo atendera sin problemas.',
    'En el grupo principal las reincidencias generan multa de oro durante el dia.',
  ], { icon: '🛡️' });
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
  return heraldCard('Acceso temporalmente bloqueado', [
    `Tu acceso a *!${commandName}* esta bloqueado por no haber roleado en los ultimos *${getRoleplayLockWindowDays()} dias*.`,
    'Vuelve a rolear en el grupo principal del reino para desbloquear minijuegos, economia y consultas recreativas.',
    heraldStat('Grupo valido', `\`${ROLEPLAY_ACTIVITY_GROUP_ID}\``),
  ], { icon: '🔒' });
}

function formatInitializeError(error) {
  if (!error) {
    return 'Unknown initialization error';
  }

  const message = sanitizeLogText(error?.message ?? error);
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

function isInvalidAuthDisconnectReason(reason) {
  return ['LOGOUT', 'UNPAIRED', 'UNPAIRED_IDLE'].includes(
    String(reason ?? '').trim().toUpperCase()
  );
}

async function clearAuthDataPath(reasonLabel) {
  try {
    let cleared = false;
    if (whatsappAuthStrategyMode === 'remote') {
      await authStrategy.purgeRemoteSession();
      await authStrategy.removeLocalSession();
      cleared = true;
    }

    if (fs.existsSync(authSessionPath)) {
      fs.rmSync(authSessionPath, { recursive: true, force: true });
      cleared = true;
    }

    if (cleared) {
      console.log(`[auth cleanup] Perfil de autenticacion eliminado: ${reasonLabel}`);
    }
    return cleared;
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

async function sendBotText(msg, text, {
  preferReply = true,
  context = 'message',
  mentions = [],
} = {}) {
  const chunks = splitOutgoingText(text);

  for (const [index, chunk] of chunks.entries()) {
    const shouldReply = preferReply && index === 0;
    const sendOptions = index === 0 && mentions.length > 0 ? { mentions } : {};
    if (shouldReply && typeof msg?.reply === 'function') {
      try {
        await msg.reply(chunk, msg.from, sendOptions);
        continue;
      } catch (replyError) {
        console.warn(`[delivery:${context}] msg.reply fallo; intentando envio directo.`, replyError?.message ?? replyError);
      }
    }

    try {
      await client.sendMessage(msg.from, chunk, sendOptions);
    } catch (directError) {
      const plainText = buildPlainTextFallback(chunk);
      if (plainText !== chunk) {
        console.warn(`[delivery:${context}] envio directo fallo; reintentando como texto plano.`, directError?.message ?? directError);
        await client.sendMessage(msg.from, plainText, sendOptions);
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

const persistedRuntimeStatus = readPersistedRuntimeStatus();
const whatsappHealth = createWhatsappHealthTracker({
  stabilityWindowMs: WHATSAPP_HEALTH_STABILITY_MS,
  requiredProbeSuccesses: WHATSAPP_READY_HEALTH_FAILURE_LIMIT,
  failureLimit: WHATSAPP_READY_HEALTH_FAILURE_LIMIT,
  initialTelemetry: persistedRuntimeStatus ?? {},
});
const reconnectAudit = createReconnectAudit(persistedRuntimeStatus ?? {});
let remoteAuthStatus = {
  mode: whatsappAuthStrategyMode,
  snapshotState: whatsappAuthStrategyMode === 'remote' ? 'checking' : 'not_applicable',
  snapshotAvailable: false,
  lastSnapshotAt: persistedRuntimeStatus?.remoteAuthLastSnapshotAt ?? null,
  lastRestoreAt: null,
  usedFallback: false,
  lastError: null,
};
const pendingPageInboundSignals = new Map();
const recentNodeInboundSignals = new Map();

function sanitizePersistedRuntimeEvent(entry) {
  const event = String(entry?.event ?? 'unknown');
  return {
    ...entry,
    event,
    status: sanitizeLogText(entry?.status ?? ''),
    detail: event.startsWith('message_')
      ? 'Detalle de mensaje previo eliminado por privacidad.'
      : sanitizeLogText(entry?.detail ?? ''),
  };
}

let runtimeStatus = {
  appStartedAt: currentBootAt,
  status: appStatus,
  lastEvent: persistedRuntimeStatus?.lastEvent ?? 'boot',
  lastEventAt: persistedRuntimeStatus?.lastEventAt ?? null,
  lastEventDetail: String(persistedRuntimeStatus?.lastEvent ?? '').startsWith('message_')
    ? 'Detalle de mensaje previo eliminado por privacidad.'
    : sanitizeLogText(persistedRuntimeStatus?.lastEventDetail ?? ''),
  recentEvents: Array.isArray(persistedRuntimeStatus?.recentEvents)
    ? persistedRuntimeStatus.recentEvents.slice(0, 40).map(sanitizePersistedRuntimeEvent)
    : [],
  restartCount: Number.parseInt(String(persistedRuntimeStatus?.restartCount ?? 0), 10) || 0,
  functionalRecoveryAttempts:
    Number.parseInt(String(persistedRuntimeStatus?.functionalRecoveryAttempts ?? 0), 10) || 0,
  functionalRecoveryWindowStartedAt:
    persistedRuntimeStatus?.functionalRecoveryWindowStartedAt ?? null,
  lastDisconnectReason: sanitizeLogText(persistedRuntimeStatus?.lastDisconnectReason ?? ''),
  lastDisconnectAt: persistedRuntimeStatus?.lastDisconnectAt ?? null,
};

function buildPublicStatus() {
  const health = whatsappHealth.snapshot();
  const reconnect = reconnectAudit.snapshot();
  const reconnectReady = whatsappAuthStrategyMode === 'remote'
    ? remoteAuthStatus.snapshotAvailable
    : authPersistenceEvidence.verifiedAcrossRestart;
  return {
    status: appStatus,
    operational: isWhatsappOperational(),
    qrVisible: Boolean(latestQrDataUrl),
    qrLastUpdatedAt: latestQrUpdatedAt,
    pairingCodeEnabled: Boolean(WHATSAPP_PAIR_PHONE_NUMBER),
    pairingCodeVisible: Boolean(latestPairingCode),
    pairingCodeLastUpdatedAt: latestPairingCodeUpdatedAt,
    lastEvent: runtimeStatus.lastEvent,
    lastEventAt: runtimeStatus.lastEventAt,
    lastEventDetail: runtimeStatus.lastEventDetail,
    lastDisconnectReason: runtimeStatus.lastDisconnectReason,
    lastDisconnectAt: runtimeStatus.lastDisconnectAt,
    recentEvents: runtimeStatus.recentEvents.slice(0, 12),
    restartCount: runtimeStatus.restartCount,
    whatsappState: lastWhatsappState,
    whatsappStateLastCheckedAt: lastWhatsappStateCheckedAt,
    whatsappStateFailureCount,
    whatsappStateFailureLimit: WHATSAPP_READY_HEALTH_FAILURE_LIMIT,
    whatsappStateCheckError: whatsappStateCheckError || null,
    connectionHealth: health.state,
    connectionHealthReason: health.reason,
    connectionHealthConfidence: health.confidence,
    connectionHealthySince: health.healthySince,
    connectionReadyAt: health.connectedAt,
    lastFunctionalProbeAt: health.lastProbeAt,
    lastFunctionalProbeError: health.lastProbeError
      ? sanitizeLogText(health.lastProbeError)
      : null,
    lastInboundAt: health.lastInboundAt,
    lastSuccessfulReplyAt: health.lastSuccessfulReplyAt,
    lastOutboundAt: health.lastOutboundAt,
    lastOutboundAckAt: health.lastOutboundAckAt,
    lastNetworkProofAt: health.lastNetworkProofAt,
    lastFunctionalProofAt: health.lastFunctionalProofAt,
    lastFunctionalProofType: health.lastFunctionalProofType,
    currentConnectionProofAt: health.connectionProofAt,
    functionalProbeSuccessCount: health.consecutiveProbeSuccesses,
    functionalProbeFailureCount: health.consecutiveProbeFailures,
    functionalRecoveryAttempts: runtimeStatus.functionalRecoveryAttempts,
    functionalRecoveryWindowStartedAt: runtimeStatus.functionalRecoveryWindowStartedAt,
    ...reconnect,
    authStrategyMode: whatsappAuthStrategyMode,
    reconnectReady,
    remoteAuthSnapshotState: remoteAuthStatus.snapshotState,
    remoteAuthSnapshotAvailable: remoteAuthStatus.snapshotAvailable,
    remoteAuthLastSnapshotAt: remoteAuthStatus.lastSnapshotAt,
    remoteAuthLastRestoreAt: remoteAuthStatus.lastRestoreAt,
    remoteAuthUsedFallback: remoteAuthStatus.usedFallback,
    remoteAuthLastError: remoteAuthStatus.lastError,
    authPersistence: authPathPersistent ? 'persistent' : 'ephemeral',
    authPersistenceEvidence: authPersistenceEvidence.status,
    authPersistenceVerifiedAcrossRestart: authPersistenceEvidence.verifiedAcrossRestart,
    authPersistencePreviousBootAt: authPersistenceEvidence.previousBootAt,
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
    appStatus = sanitizeLogText(statusOverride);
  }

  const entry = {
    at: new Date().toISOString(),
    event,
    status: appStatus,
    detail: sanitizeLogText(detail).slice(0, 1000),
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

function recordVerifiedFunctionalHealth(event, detail, proof) {
  runtimeStatus.restartCount = 0;
  const reconnectResult = reconnectAudit.completeVerified(proof);
  if (!reconnectResult) {
    return recordRuntimeEvent(event, detail, appStatus);
  }

  return recordRuntimeEvent(
    'reconnection_verified',
    `La recuperacion ${reconnectResult.trigger} quedo operativa mediante ${reconnectResult.proof} tras ${Math.round(reconnectResult.durationMs / 1000)}s.`,
    appStatus
  );
}

function handleRemoteAuthEvent(event, payload = {}) {
  const at = new Date().toISOString();
  if (event === 'saved') {
    const firstSnapshot = !remoteAuthStatus.snapshotAvailable;
    remoteAuthStatus = {
      ...remoteAuthStatus,
      snapshotState: 'saved',
      snapshotAvailable: true,
      lastSnapshotAt: payload.createdAt || at,
      lastError: null,
    };
    if (firstSnapshot) {
      recordRuntimeEvent(
        'remote_auth_snapshot_saved',
        'La sesion fue archivada y verificada en el bucket persistente.',
        appStatus
      );
    } else {
      persistRuntimeStatus();
    }
    return;
  }

  if (event === 'restored') {
    reconnectAudit.start('remote_auth_restore');
    remoteAuthStatus = {
      ...remoteAuthStatus,
      snapshotState: payload.usedFallback ? 'restored_fallback' : 'restored',
      snapshotAvailable: true,
      lastSnapshotAt: payload.createdAt || remoteAuthStatus.lastSnapshotAt,
      lastRestoreAt: at,
      usedFallback: payload.usedFallback === true,
      lastError: null,
    };
    recordRuntimeEvent(
      payload.usedFallback ? 'remote_auth_snapshot_fallback_restored' : 'remote_auth_snapshot_restored',
      payload.usedFallback
        ? 'El snapshot mas reciente fallo su integridad; se restauro una version anterior valida.'
        : 'La sesion se restauro desde un snapshot verificado del bucket.',
      appStatus
    );
    return;
  }

  if (event === 'save_failed') {
    const error = sanitizeLogText(payload.error || 'remote auth snapshot failed');
    const shouldRecord = remoteAuthStatus.lastError !== error;
    remoteAuthStatus = {
      ...remoteAuthStatus,
      snapshotState: remoteAuthStatus.snapshotAvailable ? 'save_failed_using_previous' : 'save_failed',
      lastError: error,
    };
    if (shouldRecord) {
      recordRuntimeEvent(
        'remote_auth_snapshot_failed',
        `${error}. El ultimo snapshot valido no se elimina.`,
        appStatus
      );
    } else {
      persistRuntimeStatus();
    }
    return;
  }

  if (event === 'deleted') {
    remoteAuthStatus = {
      ...remoteAuthStatus,
      snapshotState: 'deleted',
      snapshotAvailable: false,
      lastSnapshotAt: null,
      lastRestoreAt: null,
      usedFallback: false,
      lastError: null,
    };
    recordRuntimeEvent(
      'remote_auth_snapshot_deleted',
      'La invalidacion explicita elimino los snapshots remotos de autenticacion.',
      appStatus
    );
    return;
  }

  if (event === 'disconnect_preserved') {
    console.log('[remote auth] Desconexion transitoria: el ultimo snapshot valido se conserva.');
  }
}

function renderStatusMetaHtml() {
  const health = whatsappHealth.snapshot();
  const reconnect = reconnectAudit.snapshot();
  const recentEventsHtml = runtimeStatus.recentEvents
    .slice(0, 3)
    .map((entry) => {
      const detailHtml = entry.detail
        ? `<span style="display:block;color:#a3a3a8;font-size:12px;line-height:1.45;margin-top:4px;">${escapeHtml(entry.detail)}</span>`
        : '';
      return `<li style="list-style:none;background:#151515;border:1px solid #262626;border-radius:10px;padding:10px 12px;text-align:left;"><strong style="display:block;color:#f5f5f7;margin-bottom:2px;">${escapeHtml(entry.event)}</strong><span style="display:block;color:#9696a0;font-size:12px;">${formatStatusTimestamp(entry.at)}</span>${detailHtml}</li>`;
    })
    .join('');

  const storageLabel = whatsappAuthStrategyMode === 'remote'
    ? remoteAuthStatus.snapshotAvailable
      ? 'Snapshot verificado'
      : 'Snapshot pendiente'
    : !authPathPersistent
      ? 'Temporal'
      : authPersistenceEvidence.verifiedAcrossRestart
        ? 'Persistencia verificada'
        : 'Persistente; falta otro boot';
  const storageDetail = whatsappAuthStrategyMode === 'remote'
    ? `remote / ${remoteAuthStatus.snapshotState}`
    : authPersistenceEvidence.status;
  const reconnectResult = reconnect.lastReconnectResult;
  const reconnectLabel = reconnect.pendingReconnectAttempt
    ? 'EN CURSO'
    : reconnectResult?.outcome === 'verified'
      ? 'VERIFICADA'
      : reconnectResult?.outcome === 'failed'
        ? 'FALLIDA'
        : 'Sin registro';
  const reconnectColor = reconnect.pendingReconnectAttempt
    ? '#ffc107'
    : reconnectResult?.outcome === 'verified'
      ? '#4caf50'
      : reconnectResult?.outcome === 'failed'
        ? '#ff6b6b'
        : '#f5f5f7';
  const resetLabel =
    RESET_AUTH_ENABLED && RESET_AUTH_TOKEN
      ? 'Protegido por token'
      : RESET_AUTH_ENABLED
        ? 'Mal configurado'
        : 'Desactivado';
  const healthColor = health.state === WHATSAPP_HEALTH_STATE.HEALTHY
    ? '#4caf50'
    : health.state === WHATSAPP_HEALTH_STATE.DEGRADED || health.state === WHATSAPP_HEALTH_STATE.QUARANTINED
      ? '#ff6b6b'
      : '#ffc107';

  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:18px;">
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Sesion</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;">${storageLabel}</strong>
        <small style="display:block;color:#9696a0;">${escapeHtml(storageDetail)}</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Reset manual</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;">${resetLabel}</strong>
        <small style="display:block;color:#9696a0;">/status.json disponible</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Socket</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;">${escapeHtml(health.socketState || lastWhatsappState || 'Sin verificar')}</strong>
        <small style="display:block;color:#9696a0;">${formatStatusTimestamp(lastWhatsappStateCheckedAt)}</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Canal de mensajes</span>
        <strong style="display:block;color:${healthColor};margin:4px 0 2px;">${escapeHtml(health.state)}</strong>
        <small style="display:block;color:#9696a0;">${escapeHtml(health.lastFunctionalProofType || health.confidence)}</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Ultimo mensaje entrante</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;font-size:13px;">${formatStatusTimestamp(health.lastInboundAt)}</strong>
        <small style="display:block;color:#9696a0;">Trafico real</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Ultima respuesta confirmada</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;font-size:13px;">${formatStatusTimestamp(health.lastOutboundAckAt || health.lastSuccessfulReplyAt)}</strong>
        <small style="display:block;color:#9696a0;">ACK del servidor</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Sesion lista desde</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;font-size:13px;">${formatStatusTimestamp(health.connectedAt)}</strong>
        <small style="display:block;color:#9696a0;">Recuperaciones: ${runtimeStatus.functionalRecoveryAttempts}</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Ultima reconexion</span>
        <strong style="display:block;color:${reconnectColor};margin:4px 0 2px;">${reconnectLabel}</strong>
        <small style="display:block;color:#9696a0;">${escapeHtml(reconnectResult?.proof || reconnect.pendingReconnectAttempt?.trigger || `${reconnect.reconnectVerifiedCount}/${reconnect.reconnectAttemptCount} verificadas`)}</small>
      </div>
      <div style="background:#161616;border:1px solid #2f2f2f;border-radius:12px;padding:14px;text-align:left;">
        <span style="display:block;color:#9696a0;font-size:12px;">Ultima desconexion</span>
        <strong style="display:block;color:#f5f5f7;margin:4px 0 2px;">${escapeHtml(runtimeStatus.lastDisconnectReason || 'Sin registro')}</strong>
        <small style="display:block;color:#9696a0;">${formatStatusTimestamp(runtimeStatus.lastDisconnectAt)}</small>
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
    connectionHealth: currentStatus.connectionHealth ?? '',
    lastInboundAt: currentStatus.lastInboundAt ?? '',
    lastSuccessfulReplyAt: currentStatus.lastSuccessfulReplyAt ?? '',
    lastFunctionalProbeAt: currentStatus.lastFunctionalProbeAt ?? '',
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
          markers.connectionHealth = String(next.connectionHealth ?? '');
          markers.lastInboundAt = String(next.lastInboundAt ?? '');
          markers.lastSuccessfulReplyAt = String(next.lastSuccessfulReplyAt ?? '');
          markers.lastFunctionalProbeAt = String(next.lastFunctionalProbeAt ?? '');
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
            const healthChanged =
              String(next.connectionHealth ?? '') !== String(markers.connectionHealth ?? '') ||
              String(next.lastInboundAt ?? '') !== String(markers.lastInboundAt ?? '') ||
              String(next.lastSuccessfulReplyAt ?? '') !== String(markers.lastSuccessfulReplyAt ?? '') ||
              String(next.lastFunctionalProbeAt ?? '') !== String(markers.lastFunctionalProbeAt ?? '');

            if (qrChanged && !structureChanged) {
              const updatedInline = await applyLiveQrUpdate(next);
              if (updatedInline) {
                return;
              }
            }

            if (structureChanged || eventChanged || statusChanged || healthChanged || qrChanged || pairingChanged) {
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

function isWhatsappOperational() {
  try {
    return Boolean(
      whatsappClientReady &&
      whatsappHealth.isHealthy() &&
      client?.info &&
      client.pupPage &&
      !client.pupPage.isClosed()
    );
  } catch {
    return false;
  }
}

function applyWhatsappHealthStatus(health = whatsappHealth.snapshot()) {
  if (health.state === WHATSAPP_HEALTH_STATE.HEALTHY) {
    appStatus = 'Conectado a WhatsApp. Canal de mensajes saludable.';
  } else if (health.state === WHATSAPP_HEALTH_STATE.CONNECTED_UNVERIFIED) {
    appStatus = 'Conectado; verificando el canal de mensajes...';
  } else if (health.state === WHATSAPP_HEALTH_STATE.DEGRADED) {
    appStatus = 'Canal de WhatsApp degradado. Envios automaticos pausados.';
  } else if (health.state === WHATSAPP_HEALTH_STATE.QUARANTINED) {
    appStatus = 'Sesion de WhatsApp aislada. Se requiere intervencion manual.';
  }
  return appStatus;
}

function pauseWhatsappDelivery(reason, socketState = lastWhatsappState || 'UNKNOWN') {
  whatsappClientReady = false;
  let health = whatsappHealth.snapshot();
  if (health.state !== WHATSAPP_HEALTH_STATE.DEGRADED) {
    health = whatsappHealth.recordProbe({
      ok: false,
      socketState,
      reason,
      error: reason,
    });
  }
  whatsappStateFailureCount = health.consecutiveProbeFailures;
  whatsappStateCheckError = reason;
  applyWhatsappHealthStatus(health);
  return health;
}

function clearInboundHealthSignals() {
  pendingPageInboundSignals.clear();
  recentNodeInboundSignals.clear();
}

function recordPageInboundSignal(messageId) {
  const normalizedId = String(messageId ?? '').trim();
  if (!normalizedId) return;
  const alreadyForwardedAt = recentNodeInboundSignals.get(normalizedId);
  if (alreadyForwardedAt && Date.now() - alreadyForwardedAt < WHATSAPP_BRIDGE_EVENT_TIMEOUT_MS * 2) {
    recentNodeInboundSignals.delete(normalizedId);
    return;
  }

  pendingPageInboundSignals.set(normalizedId, Date.now());
  if (pendingPageInboundSignals.size > 1000) {
    pendingPageInboundSignals.delete(pendingPageInboundSignals.keys().next().value);
  }
}

function markWhatsappInbound(msg, source = 'message') {
  const messageId = String(msg?.id?._serialized ?? msg?.id?.id ?? '').trim();
  if (messageId) {
    pendingPageInboundSignals.delete(messageId);
    recentNodeInboundSignals.set(messageId, Date.now());
    if (recentNodeInboundSignals.size > 1000) {
      recentNodeInboundSignals.delete(recentNodeInboundSignals.keys().next().value);
    }
  }

  const wasHealthy = whatsappHealth.isHealthy();
  const health = whatsappHealth.markInbound();
  whatsappClientReady = true;
  whatsappStateFailureCount = 0;
  whatsappStateCheckError = '';
  applyWhatsappHealthStatus(health);

  if (!wasHealthy) {
    recordVerifiedFunctionalHealth(
      'functional_health_recovered_by_inbound',
      `El canal de eventos recibio trafico real (${source}); la sesion queda habilitada.`,
      'inbound_traffic'
    );
  } else {
    persistRuntimeStatus();
  }
}

function getStalePageInboundSignal() {
  const now = Date.now();
  for (const [messageId, seenAt] of recentNodeInboundSignals) {
    if (now - seenAt >= WHATSAPP_BRIDGE_EVENT_TIMEOUT_MS * 2) {
      recentNodeInboundSignals.delete(messageId);
    }
  }
  for (const seenAt of pendingPageInboundSignals.values()) {
    const ageMs = now - seenAt;
    if (ageMs >= WHATSAPP_BRIDGE_EVENT_TIMEOUT_MS) {
      return { stale: true, ageMs };
    }
  }
  return { stale: false, ageMs: 0 };
}

function resetExpiredFunctionalRecoveryWindow() {
  const startedAt = Date.parse(String(runtimeStatus.functionalRecoveryWindowStartedAt ?? ''));
  if (
    runtimeStatus.functionalRecoveryAttempts > 0 &&
    (!Number.isFinite(startedAt) || Date.now() - startedAt >= WHATSAPP_HEALTH_RECOVERY_WINDOW_MS)
  ) {
    runtimeStatus.functionalRecoveryAttempts = 0;
    runtimeStatus.functionalRecoveryWindowStartedAt = null;
    functionalHealthReattachAttempted = false;
    persistRuntimeStatus();
  }
}

function resetFunctionalRecoveryBudgetAfterStableHealth() {
  if (!whatsappHealth.hasSustainedHealth(WHATSAPP_HEALTH_RECOVERY_RESET_MS)) return;
  if (!functionalHealthReattachAttempted && runtimeStatus.functionalRecoveryAttempts === 0) return;

  functionalHealthReattachAttempted = false;
  runtimeStatus.functionalRecoveryAttempts = 0;
  runtimeStatus.functionalRecoveryWindowStartedAt = null;
  persistRuntimeStatus();
}

async function recoverFunctionalWhatsappHealth(probe) {
  if (functionalHealthRecoveryInFlight || restartRequested || shutdownRequested) return;

  functionalHealthRecoveryInFlight = true;
  try {
    resetExpiredFunctionalRecoveryWindow();
    const detail = sanitizeLogText(probe?.error || probe?.reason || 'functional health failure');
    const canReattach = /bridge|forwarded|context/i.test(`${probe?.reason ?? ''} ${detail}`);
    const authInvalidated =
      ['UNPAIRED', 'UNPAIRED_IDLE'].includes(String(probe?.socketState ?? '').toUpperCase());
    let action = chooseFunctionalRecoveryAction({
      reattachAttempted: functionalHealthReattachAttempted || !canReattach,
      recoveryAttempts: runtimeStatus.functionalRecoveryAttempts,
      authInvalidated,
    });

    if (action === 'reattach') {
      functionalHealthReattachAttempted = true;
      recordRuntimeEvent(
        'functional_health_reattach',
        'El puente de mensajes no responde. Se reengancharan sus listeners sin desmontar la sesion.',
        'Reparando el canal de mensajes de WhatsApp...'
      );

      try {
        if (typeof client.attachEventListeners !== 'function') {
          throw new Error('La version instalada no expone attachEventListeners');
        }
        await Promise.race([
          client.attachEventListeners(),
          sleep(WHATSAPP_HEALTH_REATTACH_TIMEOUT_MS).then(() => {
            throw new Error(`Timeout reenganchando listeners tras ${WHATSAPP_HEALTH_REATTACH_TIMEOUT_MS}ms`);
          }),
        ]);
        clearInboundHealthSignals();
        whatsappClientReady = true;
        whatsappStateFailureCount = 0;
        whatsappHealth.markConnected('message_bridge_reattached');
        applyWhatsappHealthStatus();
        recordRuntimeEvent(
          'functional_health_reattach_complete',
          'Los listeners fueron reenganchados. La sesion debe superar nuevamente la ventana de estabilidad.',
          appStatus
        );
        return;
      } catch (error) {
        recordRuntimeEvent(
          'functional_health_reattach_failed',
          formatInitializeError(error),
          'No se pudo reparar el puente en caliente.'
        );
        action = chooseFunctionalRecoveryAction({
          reattachAttempted: true,
          recoveryAttempts: runtimeStatus.functionalRecoveryAttempts,
          authInvalidated,
        });
      }
    }

    if (action === 'restart' || action === 'reset-auth') {
      runtimeStatus.functionalRecoveryWindowStartedAt ??= new Date().toISOString();
      runtimeStatus.functionalRecoveryAttempts += 1;
      persistRuntimeStatus();
      requestProcessRestart(
        action === 'reset-auth'
          ? 'functional_health_clean_session_restart'
          : 'functional_health_process_restart',
        action === 'reset-auth'
          ? `${detail}. La recuperacion conservando sesion ya fallo; se solicitara una vinculacion limpia.`
          : `${detail}. Se recreara una sola vez el cliente conservando la autenticacion.`,
        {
          clearAuth: action === 'reset-auth',
          cancelIfSocketRecovered: action === 'restart',
        }
      );
      return;
    }

    whatsappClientReady = false;
    whatsappHealth.markQuarantined('functional recovery budget exhausted');
    reconnectAudit.completeFailed('recovery_budget_exhausted');
    applyWhatsappHealthStatus();
    recordRuntimeEvent(
      'functional_health_quarantined',
      'La sesion siguio fallando despues de una recuperacion conservadora y una vinculacion limpia. No se reiniciara en bucle.',
      appStatus
    );
  } finally {
    functionalHealthRecoveryInFlight = false;
  }
}

function startWhatsappConnectWatchdog() {
  const interval = setInterval(async () => {
    const hasPairingCredential = Boolean(latestQrDataUrl || latestPairingCode);

    if (restartRequested || shutdownRequested || hasPairingCredential) {
      return;
    }

    if (readyBootstrapComplete) {
      if (whatsappStateCheckInFlight || functionalHealthRecoveryInFlight) return;

      whatsappStateCheckInFlight = true;
      let probe;

      try {
        const runActiveNetworkProbe =
          whatsappStateFailureCount > 0 ||
          Date.now() - lastActiveNetworkProbeAt >= WHATSAPP_ACTIVE_NETWORK_PROBE_INTERVAL_MS;
        if (runActiveNetworkProbe) {
          lastActiveNetworkProbeAt = Date.now();
        }

        probe = await probeWhatsappClient(client, {
          timeoutMs: WHATSAPP_READY_HEALTH_TIMEOUT_MS,
          activePresenceProbe: WHATSAPP_ACTIVE_PRESENCE_PROBE,
          activeNetworkProbe: runActiveNetworkProbe,
          onPageInboundSignal: recordPageInboundSignal,
        });

        const stalePageSignal = getStalePageInboundSignal();
        if (stalePageSignal.stale) {
          probe = {
            ...probe,
            ok: false,
            reason: 'page_message_not_forwarded',
            error: `El navegador recibio un mensaje que el listener Node no proceso tras ${Math.round(stalePageSignal.ageMs / 1000)}s`,
          };
        }
      } finally {
        whatsappStateCheckInFlight = false;
      }

      lastWhatsappState = probe.socketState;
      lastWhatsappStateCheckedAt = new Date().toISOString();
      whatsappStateCheckError = sanitizeLogText(probe.error || '');
      const wasHealthy = whatsappHealth.isHealthy();
      const health = whatsappHealth.recordProbe(probe);
      whatsappStateFailureCount = health.consecutiveProbeFailures;

      if (probe.ok) {
        transientWhatsappStateStartedAt = null;
        transientWhatsappStateLogged = '';
        whatsappClientReady = true;
        applyWhatsappHealthStatus(health);

        if (health.state === WHATSAPP_HEALTH_STATE.HEALTHY && !wasHealthy) {
          recordVerifiedFunctionalHealth(
            'functional_health_healthy',
            'Socket, pagina, puente de eventos y una prueba real de red superaron la ventana de estabilidad.',
            health.lastFunctionalProofType || 'active_network'
          );
        } else {
          persistRuntimeStatus();
        }
        resetFunctionalRecoveryBudgetAfterStableHealth();
        return;
      }

      whatsappClientReady = false;
      applyWhatsappHealthStatus(health);
      const healthDetail = whatsappStateCheckError || probe.reason;
      const attemptDetail = `${healthDetail} (${health.consecutiveProbeFailures}/${WHATSAPP_READY_HEALTH_FAILURE_LIMIT}).`;
      const transientState = isTransientWhatsappState(probe.socketState);
      if (transientState) {
        transientWhatsappStateStartedAt ??= Date.now();
      } else {
        transientWhatsappStateStartedAt = null;
        transientWhatsappStateLogged = '';
      }
      const transientAgeMs = transientWhatsappStateStartedAt
        ? Date.now() - transientWhatsappStateStartedAt
        : 0;
      const withinTransientGrace =
        transientState && transientAgeMs < WHATSAPP_TRANSIENT_STATE_GRACE_MS;

      if (withinTransientGrace && transientWhatsappStateLogged !== probe.socketState) {
        transientWhatsappStateLogged = probe.socketState;
        recordRuntimeEvent(
          'functional_health_transient_wait',
          `${attemptDetail} ${probe.socketState} puede recuperarse sin reiniciar; se esperaran hasta ${Math.round(WHATSAPP_TRANSIENT_STATE_GRACE_MS / 1000)}s.`,
          appStatus
        );
      } else if (health.consecutiveProbeFailures === 1) {
        recordRuntimeEvent('functional_health_degraded', attemptDetail, appStatus);
      } else {
        persistRuntimeStatus();
      }

      if (whatsappHealth.hasReachedFailureLimit() && !withinTransientGrace) {
        await recoverFunctionalWhatsappHealth(probe);
      }
      return;
    }

    if (whatsappClientReady) return;

    const idleMs = Date.now() - lastWhatsappProgressAt;
    if (idleMs < WHATSAPP_CONNECT_STALL_TIMEOUT_MS) {
      return;
    }

    const reconnectDelayMs = calculateReconnectDelayMs(
      runtimeStatus.restartCount + 1,
      WHATSAPP_INIT_RETRY_DELAY_MS,
      WHATSAPP_RECONNECT_MAX_DELAY_MS
    );
    requestProcessRestart(
      'connect_watchdog_restart',
      `Sin QR ni conexion despues de ${Math.round(idleMs / 1000)}s.`,
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

  if (url.pathname === '/healthz') {
    const operational = isWhatsappOperational();
    const status = buildPublicStatus();
    res.writeHead(operational ? 200 : 503, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
    });
    res.end(`${JSON.stringify({
      ok: operational,
      connectionHealth: status.connectionHealth,
      connectionHealthReason: status.connectionHealthReason,
      lastFunctionalProofAt: status.lastFunctionalProofAt,
      lastFunctionalProofType: status.lastFunctionalProofType,
      reconnectReady: status.reconnectReady,
      remoteAuthSnapshotState: status.remoteAuthSnapshotState,
      remoteAuthLastSnapshotAt: status.remoteAuthLastSnapshotAt,
      pendingReconnectAttempt: status.pendingReconnectAttempt,
      lastReconnectResult: status.lastReconnectResult,
    }, null, 2)}\n`);
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
    if (!RESET_AUTH_ENABLED) {
      console.warn('[HTTP Reset] Intento remoto bloqueado: endpoint desactivado.');
      res.writeHead(404, htmlHeaders);
      res.end('Not found');
      return;
    }

    if (!RESET_AUTH_TOKEN) {
      recordRuntimeEvent(
        'manual_reset_misconfigured',
        'Se intento usar reset manual, pero falta RESET_AUTH_TOKEN.',
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
        'Token invalido para reset manual.',
        'Intento de reset manual bloqueado.'
      );
      res.writeHead(403, htmlHeaders);
      res.end('<h1>403</h1><p>Token invalido para reset manual.</p>');
      return;
    }

    recordRuntimeEvent(
      'manual_reset_authorized',
      'Reset manual autorizado.',
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
    functionalHealthReattachAttempted = false;
    runtimeStatus.functionalRecoveryAttempts = 0;
    runtimeStatus.functionalRecoveryWindowStartedAt = null;
    requestProcessRestart(
      'manual_reset_restart',
      'Reset manual autorizado.',
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
              flex-direction: column;
              align-items: center;
              justify-content: flex-start;
              min-height: 100vh;
              background-color: #0c0c0e;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              padding: 24px 16px;
              box-sizing: border-box;
              color: #f5f5f7;
              overflow-y: auto;
            }
            .container {
              text-align: center;
              background: #18181c;
              border: 1px solid #2e2e36;
              padding: 32px 24px;
              border-radius: 20px;
              box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
              max-width: 480px;
              width: 100%;
              box-sizing: border-box;
            }
            h2 {
              margin-top: 0;
              color: #f5f5f7;
              font-size: 24px;
            }
            .qr-wrapper {
              background: #ffffff;
              padding: 20px;
              border-radius: 16px;
              display: inline-block;
              margin: 16px 0;
              box-shadow: 0 0 30px rgba(255, 255, 255, 0.25);
            }
            .qr-wrapper img {
              display: block;
              width: 280px;
              height: 280px;
              max-width: 100%;
              object-fit: contain;
              border-radius: 4px;
              transition: opacity 160ms ease, transform 160ms ease;
            }
            details summary {
              cursor: pointer;
              color: #a3a3a8;
              font-size: 13px;
              font-weight: 500;
              user-select: none;
              outline: none;
            }
            details summary:hover {
              color: #f5f5f7;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Kingdoom Bot</h2>
            <p style="font-size:15px;color:#a3a3a8;margin:6px 0 12px;">Estado actual: <strong id="qr-status-value" style="color: #ffc107;">${escapeHtml(appStatus)}</strong></p>
            <p style="font-size:16px;font-weight:600;margin:0 0 8px;color:#f5f5f7;">Escanea este código QR con WhatsApp:</p>
            <div class="qr-wrapper">
              <img id="qr-image" src="${latestQrDataUrl}" alt="Codigo QR de WhatsApp" data-qr-updated-at="${escapeHtml(latestQrUpdatedAt ?? '')}" />
            </div>
            <p id="qr-sync-hint" style="color: #ffc107; font-weight: 500; font-size: 14px; margin: 12px 0 6px;">La vista se sincroniza sola. Si WhatsApp genera un QR nuevo, la imagen se reemplazara automaticamente.</p>
            <p id="qr-updated-label" style="color:#a3a3a8;font-size:13px;margin-top:2px;">Ultima renovacion del QR: ${escapeHtml(formatStatusTimestamp(latestQrUpdatedAt))}</p>
            
            <details style="margin-top:24px;text-align:left;background:#121215;border:1px solid #282830;border-radius:12px;padding:12px 16px;">
              <summary>📊 Ver métricas detalladas del sistema y estado</summary>
              <div style="margin-top:12px;">
                ${renderStatusMetaHtml()}
              </div>
            </details>
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
              flex-direction: column;
              align-items: center;
              justify-content: flex-start;
              min-height: 100vh;
              background-color: #0c0c0e;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              margin: 0;
              padding: 24px 16px;
              box-sizing: border-box;
              color: #f5f5f7;
              overflow-y: auto;
            }
            .container {
              text-align: center;
              background: #18181c;
              border: 1px solid #2e2e36;
              padding: 32px 24px;
              border-radius: 20px;
              box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6);
              max-width: 480px;
              width: 100%;
              box-sizing: border-box;
            }
            h2 {
              margin-top: 0;
              color: ${whatsappHealth.isHealthy() ? '#4caf50' : '#ffc107'};
              font-size: 24px;
            }
            p {
              color: #a3a3a8;
              font-size: 15px;
              line-height: 1.5;
            }
            details summary {
              cursor: pointer;
              color: #a3a3a8;
              font-size: 13px;
              font-weight: 500;
              user-select: none;
              outline: none;
            }
            details summary:hover {
              color: #f5f5f7;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Kingdoom Bot</h2>
            <p>Estado del sistema: <strong style="color: ${whatsappHealth.isHealthy() ? '#4caf50' : '#ffc107'};">${escapeHtml(appStatus)}</strong></p>
            <p>El socket y el canal de mensajes se verifican por separado. Los envios automaticos solo se habilitan cuando el canal figura HEALTHY.</p>
            ${latestPairingCode ? `<p style="color:#ffc107;font-weight:600;">Codigo de vinculacion: <span style="letter-spacing:0.18em;">${escapeHtml(latestPairingCode)}</span></p>` : ''}
            
            <details style="margin-top:24px;text-align:left;background:#121215;border:1px solid #282830;border-radius:12px;padding:12px 16px;">
              <summary>📊 Ver métricas detalladas del sistema y estado</summary>
              <div style="margin-top:12px;">
                ${renderStatusMetaHtml()}
              </div>
            </details>
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

const remoteAuthStore = whatsappAuthStrategyMode === 'remote'
  ? new VersionedFileRemoteAuthStore({
      localDataPath: remoteAuthCachePath,
      storePath: remoteAuthStorePath,
      keepSnapshots: WHATSAPP_REMOTE_AUTH_KEEP_SNAPSHOTS,
      onEvent: handleRemoteAuthEvent,
    })
  : null;
const authStrategy = whatsappAuthStrategyMode === 'remote'
  ? new ResilientRemoteAuth({
      clientId: 'kingdoom-bot',
      dataPath: remoteAuthCachePath,
      store: remoteAuthStore,
      backupSyncIntervalMs: WHATSAPP_REMOTE_AUTH_BACKUP_INTERVAL_MS,
      rmMaxRetries: 10,
      onEvent: handleRemoteAuthEvent,
    })
  : new LocalAuth({ dataPath: authDataPath, rmMaxRetries: 10 });

const client = new Client({
  authStrategy,
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
    timeout: 120000,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-zygote',
      '--disable-extensions',
      '--disable-accelerated-2d-canvas',
      '--mute-audio',
      '--js-flags=--max-old-space-size=256',
    ],
  },
});

client.on('qr', async (qr) => {
  const isFirstQrOfWaitingEpisode = !qrWaitingEpisodeActive;
  qrWaitingEpisodeActive = true;
  markWhatsappProgress();
  whatsappClientReady = false;
  whatsappHealth.markUnavailable(WHATSAPP_HEALTH_STATE.WAITING_QR, 'waiting_for_qr', 'UNPAIRED');
  if (whatsappAuthStrategyMode === 'remote' && remoteAuthStatus.snapshotAvailable) {
    await authStrategy.purgeRemoteSession().catch((error) => {
      handleRemoteAuthEvent('save_failed', { error: formatInitializeError(error) });
    });
  }
  if (whatsappAuthStrategyMode === 'remote') {
    remoteAuthStatus = {
      ...remoteAuthStatus,
      snapshotState: 'awaiting_link',
      snapshotAvailable: false,
    };
  }
  clearInboundHealthSignals();
  authenticatedEventSeen = false;
  appStatus = 'Esperando escaneo de codigo QR...';
  latestQrUpdatedAt = new Date().toISOString();
  latestPairingCode = '';
  latestPairingCodeUpdatedAt = null;
  lastLoadingPercent = null;

  try {
    latestQrDataUrl = await qrcodeImage.toDataURL(qr, { margin: 2, width: 360 });
    const reconnectResult = reconnectAudit.completeFailed('pairing_required');
    if (reconnectResult) {
      recordRuntimeEvent(
        'reconnection_failed_pairing_required',
        `La recuperacion ${reconnectResult.trigger} no restauro la sesion y WhatsApp exigio una vinculacion nueva.`,
        appStatus
      );
    } else if (isFirstQrOfWaitingEpisode) {
      recordRuntimeEvent('qr', 'WhatsApp solicito un nuevo codigo QR.', appStatus);
    } else {
      persistRuntimeStatus();
    }
  } catch (err) {
    console.error('Error generating QR DataURL:', err);
    recordRuntimeEvent('qr_render_error', formatInitializeError(err), appStatus);
  }
});

client.on('code', async (code) => {
  markWhatsappProgress();
  whatsappClientReady = false;
  whatsappHealth.markUnavailable(WHATSAPP_HEALTH_STATE.WAITING_QR, 'waiting_for_pairing_code', 'UNPAIRED');
  if (whatsappAuthStrategyMode === 'remote' && remoteAuthStatus.snapshotAvailable) {
    await authStrategy.purgeRemoteSession().catch((error) => {
      handleRemoteAuthEvent('save_failed', { error: formatInitializeError(error) });
    });
  }
  if (whatsappAuthStrategyMode === 'remote') {
    remoteAuthStatus = {
      ...remoteAuthStatus,
      snapshotState: 'awaiting_link',
      snapshotAvailable: false,
    };
  }
  clearInboundHealthSignals();
  authenticatedEventSeen = false;
  latestQrDataUrl = '';
  latestQrUpdatedAt = null;
  latestPairingCode = String(code ?? '').trim();
  latestPairingCodeUpdatedAt = new Date().toISOString();
  lastLoadingPercent = null;
  const reconnectResult = reconnectAudit.completeFailed('pairing_required');
  recordRuntimeEvent(
    reconnectResult ? 'reconnection_failed_pairing_required' : 'pairing_code',
    reconnectResult
      ? `La recuperacion ${reconnectResult.trigger} no restauro la sesion y WhatsApp exigio una vinculacion nueva.`
      : 'WhatsApp genero un codigo de vinculacion por telefono.',
    'Esperando vinculacion por codigo...'
  );
});

client.on('authenticated', () => {
  if (readyBootstrapComplete || authenticatedEventSeen) return;

  qrWaitingEpisodeActive = false;
  authenticatedEventSeen = true;
  markWhatsappProgress();
  whatsappClientReady = false;
  whatsappHealth.markUnavailable(WHATSAPP_HEALTH_STATE.AUTHENTICATING, 'authenticated_syncing', 'PAIRING');
  clearInboundHealthSignals();
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
  if (readyBootstrapComplete) {
    pauseWhatsappDelivery('WhatsApp reinicio la sincronizacion interna.', 'SYNCING');
  } else {
    appStatus = `Sincronizando WhatsApp... ${roundedPercent}%`;
  }

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
  if (readyBootstrapComplete) {
    const now = Date.now();
    if (
      whatsappClientReady &&
      (now - lastReadyDuplicateLoggedAt) >= 60000
    ) {
      lastReadyDuplicateLoggedAt = now;
      recordRuntimeEvent(
        'ready_duplicate',
        'WhatsApp repitio el evento ready; se conserva el runtime ya inicializado.',
        applyWhatsappHealthStatus()
      );
    }
    return;
  }

  markWhatsappProgress();
  qrWaitingEpisodeActive = false;
  whatsappClientReady = true;
  authenticatedEventSeen = true;
  whatsappStateFailureCount = 0;
  whatsappStateCheckError = '';
  latestQrDataUrl = '';
  latestQrUpdatedAt = null;
  latestPairingCode = '';
  latestPairingCodeUpdatedAt = null;
  lastLoadingPercent = null;
  whatsappHealth.markConnected('ready_event');
  if (whatsappAuthStrategyMode === 'remote' && !remoteAuthStatus.snapshotAvailable) {
    remoteAuthStatus = {
      ...remoteAuthStatus,
      snapshotState: 'awaiting_first_snapshot',
    };
  }
  applyWhatsappHealthStatus();
  recordRuntimeEvent(
    'ready',
    authPathPersistent
      ? 'Cliente conectado. La sesion usa almacenamiento persistente.'
      : 'Cliente conectado. La sesion sigue en almacenamiento temporal; si el contenedor reinicia, puede volver a pedir QR.',
    appStatus
  );

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
      let recoveredBets = 0;
      let pendingBets = 0;
      for (const bet of orphanedBets) {
        try {
          await resolveBet(bet.id, bet.amount);
          recoveredBets += 1;
        } catch (betRecoveryError) {
          pendingBets += 1;
          console.error(`[Escrow] Reembolso pendiente para apuesta ${bet.id}:`, betRecoveryError);
          continue;
        }
        
        // Queue the notice; dispatch starts only after functional health is confirmed.
        if (bet.players && bet.players.phone) {
          const msgText = `🔮 *¡Intervención Divina!*\nEl oráculo detectó que tu partida de *${bet.game_type}* se interrumpió abruptamente debido a una falla espacio-temporal.\n\n🪙 Se han devuelto de forma segura *${bet.amount.toLocaleString('es-PY')} oro* a tus reservas.`;
          const { error: queueError } = await botStateSupabase
            .from('bot_notifications_queue')
            .insert({
              player_phone: normalizePhone(bet.players.phone),
              message: msgText,
            });
          if (queueError) {
            console.error('[Escrow] Error al encolar la notificacion de reembolso:', queueError.message);
          }
        }
      }
      console.log(`[Escrow] Recuperadas ${recoveredBets}/${orphanedBets.length} apuestas huerfanas.`);
      if (pendingBets > 0) {
        console.error(`[Escrow] Permanecen ${pendingBets} apuesta(s) pendientes para el proximo ciclo.`);
      }
    }
  } catch (escrowErr) {
    console.error('[index.js] Error al recuperar apuestas del escrow:', escrowErr);
  }
  // ------------------------------

  if (!schedulerStarted) {
    startScheduler(client, isWhatsappOperational);
    schedulerStarted = true;
  }

  if (!realtimeStarted) {
    startAuctionsRealtime(client, isWhatsappOperational);
    realtimeStarted = true;
  }
});

client.on('remote_session_saved', () => {
  console.log('[remote auth] Snapshot inicial confirmado por whatsapp-web.js.');
  persistRuntimeStatus();
});

client.on('auth_failure', (message) => {
  console.error('[whatsapp auth_failure]', sanitizeLogText(message));
  whatsappClientReady = false;
  whatsappHealth.markUnavailable(WHATSAPP_HEALTH_STATE.CONNECTING, 'authentication_failed', 'UNPAIRED');
  authenticatedEventSeen = false;
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
  const disconnectReason = sanitizeLogText(reason ?? 'UNKNOWN');
  console.warn('[whatsapp disconnected]', disconnectReason);
  const shouldClearAuth = isInvalidAuthDisconnectReason(reason);
  runtimeStatus.lastDisconnectReason = disconnectReason;
  runtimeStatus.lastDisconnectAt = new Date().toISOString();
  whatsappClientReady = false;
  whatsappHealth.markUnavailable(WHATSAPP_HEALTH_STATE.CONNECTING, 'disconnected', String(reason ?? 'UNKNOWN'));
  clearInboundHealthSignals();
  authenticatedEventSeen = false;
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
    console.warn('[whatsapp disconnected] Invalidacion explicita detectada; se descartara la sesion persistida antes de reinicializar.');
  }
  requestProcessRestart(
    'disconnected_restart',
    `WhatsApp se desconecto con motivo: ${String(reason ?? 'sin detalle')}`,
    { clearAuth: shouldClearAuth }
  );
});

client.on('change_state', (state) => {
  const normalizedState = String(state ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
  console.log('[whatsapp state]', normalizedState);
  const previousState = lastWhatsappState;
  lastWhatsappState = normalizedState;
  lastWhatsappStateCheckedAt = new Date().toISOString();
  if (isTransientWhatsappState(normalizedState)) {
    if (previousState !== normalizedState) {
      transientWhatsappStateStartedAt = Date.now();
      transientWhatsappStateLogged = '';
    }
  } else {
    transientWhatsappStateStartedAt = null;
    transientWhatsappStateLogged = '';
  }
  if (readyBootstrapComplete && normalizedState !== 'CONNECTED') {
    pauseWhatsappDelivery(`WhatsApp cambio su transporte a ${normalizedState}.`, normalizedState);
  }
  recordRuntimeEvent(
    'change_state',
    `Nuevo estado interno: ${normalizedState}`,
    applyWhatsappHealthStatus()
  );
});

client.on('message_create', (msg) => {
  if (!msg?.fromMe) return;
  whatsappHealth.markOutbound();
  persistRuntimeStatus();
});

client.on('message_ack', (msg, ack) => {
  if (!msg?.fromMe || Number(ack) < 1) return;
  const wasHealthy = whatsappHealth.isHealthy();
  const health = whatsappHealth.markOutboundAck({ certifyHealth: readyBootstrapComplete });
  if (!wasHealthy && health.state === WHATSAPP_HEALTH_STATE.HEALTHY) {
    whatsappClientReady = true;
    whatsappStateFailureCount = 0;
    whatsappStateCheckError = '';
    applyWhatsappHealthStatus(health);
    recordVerifiedFunctionalHealth(
      'functional_health_recovered_by_ack',
      'WhatsApp confirmo ante el servidor un envio saliente; el canal queda habilitado.',
      'server_ack'
    );
  } else {
    persistRuntimeStatus();
  }
});

client.on('group_join', async (notification) => {
  markWhatsappInbound(notification, 'group_join');
  try {
    await handleGroupRejoin(notification, client, playerLifecycleConfig);
    await handleGroupWelcome(notification, client, welcomeConfig);
  } catch (error) {
    console.error('[group_join]', error.message);
  }
});

client.on('group_leave', async (notification) => {
  markWhatsappInbound(notification, 'group_leave');
  try {
    await handleGroupLeave(notification, client, playerLifecycleConfig);
  } catch (error) {
    console.error('[group_leave]', error.message);
  }
});



const activityCache = new Map();
const processedMessages = new Set(); // deduplication cache
const IGNORED_INTERNAL_MESSAGE_TYPES = new Set(['e2e_notification']);

client.on('message', async (msg) => {
  if (
    msg.fromMe ||
    msg.isStatus ||
    IGNORED_INTERNAL_MESSAGE_TYPES.has(String(msg.type ?? '').toLowerCase())
  ) return;

  markWhatsappInbound(msg);

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

  const text = (
    typeof msg.caption === 'string' && msg.caption.trim()
      ? msg.caption.trim()
      : (typeof msg.body === 'string' ? msg.body.trim() : '')
  );
  const rawSender = msg.author || msg.from;
  const resolvedSenderPhone = await resolveMessageSenderPhone(msg, client);
  const sender = resolvedSenderPhone || rawSender;
  const routedMsg = createMessageView(msg, { author: sender });

  // Intercept replies (Blackjack, Tesoros, etc.)
  const hasQuotedMessage = hasQuotedMessageMetadata(routedMsg);
  if (hasQuotedMessage || isBlackjackReplyAction(text)) {
    try {
      const quotedDetails = hasQuotedMessage
        ? await safeGetQuotedDetails(routedMsg)
        : { hasQuoted: false, id: null, author: null, body: null };
      const quotedId = quotedDetails.id;
      const quotedBlackjackSessionId = quotedId
        ? findActiveQuotedMessageKey(activeSessions, quotedId)
        : null;
      const treasureMessageId = quotedId
        ? findActiveQuotedMessageKey(activeTreasures, quotedId)
        : null;
      const canUseParticipantFallback = (
        !quotedDetails.hasQuoted
        || !quotedDetails.body
        || isBlackjackBoardText(quotedDetails.body)
      );
      const fallbackBlackjackSessionId = (
        !quotedBlackjackSessionId
        && !treasureMessageId
        && canUseParticipantFallback
      )
        ? findBlackjackReplySessionKey(activeSessions, {
            chatId: msg.from,
            sender,
            action: text,
          })
        : null;
      const blackjackSessionId = quotedBlackjackSessionId || fallbackBlackjackSessionId;

      if (blackjackSessionId) {
        const session = activeSessions.get(blackjackSessionId);
        const isAllowed = session.isMultiplayer
          ? session.players.some(
              (player) => normalizePhone(player.playerPhone) === normalizePhone(sender)
            )
          : normalizePhone(sender) === normalizePhone(session.playerPhone);

        if (isAllowed) {
          const replyText = await handleBlackjackReply(
            routedMsg,
            session,
            blackjackSessionId,
            client
          );
          if (replyText) {
            await sendBotText(msg, decorateCommandReply('21', replyText), {
              context: 'blackjack_reply',
            });
          }
          return;
        }

        // Ignore replies from other players to prevent interference.
        return;
      }

      if (treasureMessageId) {
        const treasure = activeTreasures.get(treasureMessageId);
        const treasureReply = await handleTreasureReply(
          routedMsg,
          treasure,
          treasureMessageId,
          client
        );
        if (treasureReply) {
          await sendBotText(msg, treasureReply, {
            context: 'treasure_claim',
            mentions: resolvedSenderPhone ? [formatJid(resolvedSenderPhone)] : [],
          });
        }
        return;
      }

      const colosseumTarget = (quotedId || quotedDetails?.body)
        ? findColosseumBetTargetByQuotedId(quotedId, quotedDetails?.body)
        : null;
      if (colosseumTarget) {
        const colosseumReply = await handleApostarColiseo(routedMsg, client, text, {
          targetExplicit: colosseumTarget,
        });
        if (colosseumReply) {
          await sendBotText(msg, colosseumReply, { context: 'colosseum_bet' });
        }
        return;
      }

      if (
        quotedDetails.hasQuoted
        && isBlackjackReplyAction(text)
        && isBlackjackBoardText(quotedDetails.body)
      ) {
        await sendBotText(msg, decorateCommandReply(
          '21',
          'Esta partida ya no esta activa. Si hubo una apuesta retenida, queda protegida para recuperacion segura.'
        ), { context: 'blackjack_inactive' });
        return;
      }

      if (
        quotedDetails.hasQuoted
        && isTreasureClaimText(text)
        && isTreasureAnnouncementText(quotedDetails.body)
      ) {
        await sendBotText(msg, buildTreasureClaimFeedback('inactive'), {
          context: 'treasure_inactive',
        });
        return;
      }
    } catch (e) {
      console.error('[Reply Intercept Error]', e);
      await sendEmergencyText(
        msg,
        'No pude procesar esta respuesta interactiva. No se aplicara una segunda accion; intenta una vez mas.',
        'reply_intercept'
      );
      return;
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
          phoneAliases: [rawSender],
        });
        setBoundedMap(roleplayActivityCache, roleplayPhone, nowMs, 1000);

        for (const unlockedPlayer of roleplayResult.unlockedPlayers ?? []) {
          const unlockedPhone = normalizePhone(unlockedPlayer.phone ?? roleplayPhone);
          if (!unlockedPhone) continue;

          try {
            await client.sendMessage(
              formatJid(unlockedPhone),
              heraldCard('Acceso restaurado', [
                'Has vuelto a rolear en el grupo principal del reino.',
                'Los minijuegos, la economia y las consultas recreativas quedaron habilitados otra vez.',
              ], { icon: '✅' })
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
      await sendBotText(msg, visibleResponse, {
        preferReply: false,
        context: 'gm_narrative',
      });

      if (resolution.autoClosed && resolution.missionState) {
        await sendBotText(
          msg,
          `*Resultado registrado:* la mision *${trackerResult.shortId}* queda marcada como *${resolution.missionState.resultado}*.`,
          { preferReply: false, context: 'gm_resolution' }
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
  const chatScope = isDirectChat ? 'direct' : 'group';
  let slowMessageTimer = null;

  if (hasPrefix && isLidWhatsAppId(rawSender) && !resolvedSenderPhone) {
    await sendBotText(msg, heraldCard('Identidad no resuelta', [
      'WhatsApp entregó un identificador privado que no se pudo vincular con tu teléfono.',
      'Vuelve a enviar el comando o pide al staff que verifique tu vínculo antes de operar con oro o perfiles.',
    ], { icon: '⚠️' }), { context: 'lid_resolution' });
    return;
  }

  if (shouldTraceMessageFlow) {
    console.log(
      `[message inbound] scope=${chatScope} type=${msg.type ?? 'unknown'} command=${commandLabel}`
    );
    recordRuntimeEvent(
      'message_inbound',
      `Entrada ${chatScope}: ${commandLabel}.`,
      hasPrefix ? `Procesando ${commandLabel}...` : appStatus
    );
  }

  if (hasPrefix) {
    slowMessageTimer = setTimeout(() => {
      console.warn(
        `[message slow] scope=${chatScope} command=${commandLabel} supero ${COMMAND_PROCESSING_WARN_MS}ms`
      );
      recordRuntimeEvent(
        'message_processing_slow',
        `${commandLabel} sigue en curso despues de ${COMMAND_PROCESSING_WARN_MS}ms.`,
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
    setBoundedMap(activityCache, sender, nowMs, 1000);
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

  const isMarketSessionActive = !!getMarketForgeSession(msg.from, sender);
  const isMarketCommand = hasPrefix && (command === 'forjaritem' || (command === 'mercado' && body.toLowerCase().startsWith('crear')));
  const isPossibleAdminCmd = hasPrefix && isKnownAdminCommand(command);
  const isRoleplayBlockedCommand = hasPrefix && ROLEPLAY_BLOCKED_COMMANDS.has(command);
  const isRestrictedMainGroupMinigame =
    hasPrefix &&
    msg.from === RESTRICTED_MINIGAME_GROUP_ID &&
    RESTRICTED_MINIGAME_COMMANDS.has(command);

  let isAdmin = false;
  let isStaff = false;
  let isPrivileged = false;
  const isSenderOwner = isOwner(sender);

  if (isMarketSessionActive || isMarketCommand || isPossibleAdminCmd || isRestrictedMainGroupMinigame || isRoleplayBlockedCommand) {
    isAdmin = await checkIsAdmin(sender);
    isStaff = isStaffUser(sender);
    isPrivileged = isAdmin || isStaff;
  }

  let reply = '';

  const wrapMsg = (originalMsg, newBody) => createMessageView(originalMsg, { body: newBody });

  try {
    const forgeReply = await handleMarketForgeConversation(routedMsg, {
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

            recordRestrictedGroupCommandViolation({
              playerId: player.id,
              scopeKey: RESTRICTED_MINIGAME_SCOPE_KEY,
              commandName: command,
              penaltyGold: appliedPenalty,
            }).catch((err) => console.error('[restricted command violation log error]', err));
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
      } else if (canRunAdminCommand(command, { isOwner: isSenderOwner, isAdmin, isStaff })) {
        reply = await handleAdminCommand(
          wrapMsg(routedMsg, ensurePrefixedBody(command, text, body)),
          client
        );
      } else if (command === 'registrar') {
        reply = 'El comando *!registrar* esta restringido unicamente a los Administradores del Reino.';
      } else if (command === 'dados') {
        reply = await handleDados(wrapMsg(routedMsg, ensurePrefixedBody(command, text, body)));
      } else if (command === 'cofre') {
        reply = await handleCofre(wrapMsg(routedMsg, ensurePrefixedBody(command, text, body)));
      } else if (command === 'trampa') {
        reply = await handleTrampa(wrapMsg(routedMsg, ensurePrefixedBody(command, text, body)));
      } else if (command === 'oraculo') {
        reply = await handleOraculo(wrapMsg(routedMsg, ensurePrefixedBody(command, text, body)));
      } else if (command === '21') {
        reply = await handleBlackjack(wrapMsg(routedMsg, ensurePrefixedBody(command, text, body)), client);
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
          'coliseo',
          'arena',
          'gladiadores',
          'torneo',
          'apostar',
          'apostarcoliseo',
        ].includes(command)
      ) {
        reply = await handlePlayerMessage(wrapMsg(routedMsg, ensurePrefixedBody(command, text, body)), client);
      } else {
        reply = await handlePlayerMessage(routedMsg, client);
      }
    }

    if (reply) {
      const replyCommand = hasPrefix ? command : isMarketSessionActive ? 'forjaritem' : '';
      const visibleReply = replyCommand ? decorateCommandReply(replyCommand, reply) : reply;
      await sendBotText(msg, visibleReply, { context: command || 'message' });
      whatsappHealth.markReply();
      persistRuntimeStatus();
      if (slowMessageTimer) {
        clearTimeout(slowMessageTimer);
        slowMessageTimer = null;
      }
      if (shouldTraceMessageFlow) {
        console.log(
          `[message reply] scope=${chatScope} command=${commandLabel} chars=${String(visibleReply).length}`
        );
        recordRuntimeEvent(
          'message_replied',
          `${commandLabel} respondido en chat ${chatScope}.`,
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
        `${commandLabel} fallo: ${formatInitializeError(err)}`,
        hasPrefix ? `Fallo ${commandLabel}.` : appStatus
      );
    }
    console.error('[message error]', formatInitializeError(err));
    const emergencyText = hasPrefix
      ? decorateCommandReply(command, '⚠️ El reino esta en llamas... intenta de nuevo en un momento.')
      : 'El reino esta en llamas... intenta de nuevo en un momento.';
    await sendEmergencyText(msg, emergencyText, 'message_error');
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
        const removedLocks = cleanupStaleChromiumLocks(
          chromiumAuthDataPath,
          chromiumSessionDirName
        );
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
        whatsappHealth.markUnavailable(WHATSAPP_HEALTH_STATE.CONNECTING, 'initialize_attempt');
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
          console.error(
            '[whatsapp init] Se agotaron los reintentos de inicializacion. Se reiniciara conservando autenticacion.'
          );
          recordRuntimeEvent(
            'initialize_failed_restart',
            `Se agotaron los reintentos, pero la autenticacion se conserva. Error final: ${formattedError}`,
            'Fallo de inicializacion. Reintentando sin borrar sesion...'
          );
          const reconnectDelayMs = calculateReconnectDelayMs(
            runtimeStatus.restartCount + 1,
            WHATSAPP_INIT_RETRY_DELAY_MS,
            WHATSAPP_RECONNECT_MAX_DELAY_MS
          );
          requestProcessRestart(
            'initialize_exhausted_restart',
            `Se agotaron ${WHATSAPP_INIT_MAX_RETRIES} intento(s). Error final: ${formattedError}`,
            {
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

function handleProcessRuntimeError(logLabel, restartEvent, error, deferTransientContext) {
  const formattedError = formatInitializeError(error);
  const classification = classifyWhatsappRuntimeError(error);
  console.error(`[process ${logLabel}] ${formattedError}`);

  if (classification.transientContext && deferTransientContext) {
    whatsappClientReady = false;
    whatsappHealth.recordProbe({
      ok: false,
      socketState: lastWhatsappState || 'CHECK_ERROR',
      reason: 'execution_context_navigation',
      error: formattedError,
    });
    recordRuntimeEvent(
      'execution_context_navigation',
      `${formattedError} Se espera el resultado de disconnected o de la comprobacion activa antes de reiniciar.`,
      'Verificando conexion de WhatsApp...'
    );
    return;
  }

  if (classification.restartable) {
    console.error('El cliente de WhatsApp esta en un estado irrecuperable. Reiniciando el proceso...');
    requestProcessRestart(restartEvent, formattedError);
  }
}

process.on('unhandledRejection', (reason) => {
  handleProcessRuntimeError('unhandledRejection', 'unhandled_rejection_restart', reason, true);
});

process.on('uncaughtException', (error) => {
  handleProcessRuntimeError('uncaughtException', 'uncaught_exception_restart', error, false);
});

async function backupRemoteAuthBeforeShutdown(reason) {
  if (
    whatsappAuthStrategyMode !== 'remote' ||
    !readyBootstrapComplete ||
    typeof authStrategy?.forceBackup !== 'function'
  ) {
    return false;
  }

  console.log(`[remote auth] Guardando snapshot antes de ${reason}.`);
  try {
    const saved = await Promise.race([
      authStrategy.forceBackup(),
      sleep(WHATSAPP_REMOTE_AUTH_BACKUP_TIMEOUT_MS).then(() => {
        throw new Error(`Timeout guardando snapshot tras ${WHATSAPP_REMOTE_AUTH_BACKUP_TIMEOUT_MS}ms`);
      }),
    ]);
    if (!saved && !remoteAuthStatus.snapshotAvailable) {
      recordRuntimeEvent(
        'remote_auth_snapshot_not_ready',
        'El primer snapshot estable aun no estaba disponible; este proceso no se declara reconectable.',
        appStatus
      );
    }
    return saved;
  } catch (error) {
    handleRemoteAuthEvent('save_failed', { error: formatInitializeError(error) });
    return false;
  }
}

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
  if (shutdownRequested) return false;

  const clearAuth = options.clearAuth === true;
  const cancelIfSocketRecovered = options.cancelIfSocketRecovered === true && !clearAuth;
  if (restartRequested) {
    if (!cancelIfSocketRecovered) {
      restartCanBeCancelledOnConnected = false;
    }
    if (clearAuth && !restartClearAuthRequested) {
      restartClearAuthRequested = true;
      restartClearAuthEvent = event;
      reconnectAudit.start(event, { authReset: true });
      recordRuntimeEvent(
        'restart_auth_clear_escalated',
        `${detail} El reinicio ya estaba programado y ahora descartara la autenticacion invalida.`,
        'Recuperando conexion de WhatsApp...'
      );
      return true;
    }
    return false;
  }

  restartRequested = true;
  restartCanBeCancelledOnConnected = cancelIfSocketRecovered;
  restartClearAuthRequested = clearAuth;
  restartClearAuthEvent = clearAuth ? event : '';
  whatsappClientReady = false;
  whatsappHealth.markUnavailable(WHATSAPP_HEALTH_STATE.CONNECTING, event);
  clearInboundHealthSignals();
  const delayMs = Math.max(WHATSAPP_RESTART_GRACE_MS, Number(options.delayMs) || 0);
  reconnectAudit.start(event, { authReset: clearAuth });
  runtimeStatus.restartCount += 1;
  recordRuntimeEvent(
    event,
    `${detail} Recuperacion ordenada en ${Math.round(delayMs / 1000)}s${clearAuth ? '; la autenticacion se limpiara despues de cerrar Chromium' : '; la autenticacion se conservara'}.`,
    'Recuperando conexion de WhatsApp...'
  );

  setTimeout(async () => {
    try {
      if (
        restartCanBeCancelledOnConnected &&
        !restartClearAuthRequested &&
        String(lastWhatsappState ?? '').toUpperCase() === 'CONNECTED'
      ) {
        restartRequested = false;
        restartCanBeCancelledOnConnected = false;
        restartClearAuthRequested = false;
        restartClearAuthEvent = '';
        whatsappClientReady = readyBootstrapComplete;
        whatsappStateFailureCount = 0;
        whatsappStateCheckError = '';
        runtimeStatus.restartCount = Math.max(0, runtimeStatus.restartCount - 1);
        runtimeStatus.functionalRecoveryAttempts = Math.max(
          0,
          runtimeStatus.functionalRecoveryAttempts - 1
        );
        if (runtimeStatus.functionalRecoveryAttempts === 0) {
          runtimeStatus.functionalRecoveryWindowStartedAt = null;
        }
        whatsappHealth.markConnected('restart_cancelled_socket_recovered');
        recordRuntimeEvent(
          'restart_cancelled_socket_recovered',
          `Se cancelo el reinicio ${event}: el socket volvio a CONNECTED antes de cerrar Chromium. El canal sera verificado nuevamente.`,
          applyWhatsappHealthStatus()
        );
        return;
      }

      if (!restartClearAuthRequested) {
        await backupRemoteAuthBeforeShutdown(event);
      }
      await closeWhatsappBrowser();
      if (restartClearAuthRequested) {
        await clearAuthDataPath(restartClearAuthEvent || event);
      }
      recordRuntimeEvent(
        'restart_worker_exit',
        `Saliendo del proceso del bot tras el evento ${event}; el supervisor lo recreara sin desmontar la sesion persistente.`,
        'Reiniciando proceso del bot...'
      );
      await sleep(1000);
      process.exit(1);
    } catch (error) {
      const formattedError = formatInitializeError(error);
      console.error(`[whatsapp recovery] Error al intentar reiniciar: ${formattedError}`);
      process.exit(1);
    }
  }, delayMs);

  return true;
}

async function shutdownForSignal(signal) {
  if (shutdownRequested) return;
  shutdownRequested = true;
  whatsappClientReady = false;
  if (signal === 'SIGTERM') {
    reconnectAudit.start('platform_sigterm_restart');
  }
  whatsappHealth.markUnavailable(WHATSAPP_HEALTH_STATE.STOPPED, signal);
  recordRuntimeEvent(
    'process_shutdown',
    `El contenedor recibio ${signal}; cerrando Chromium antes de salir.`,
    'Cerrando bot de forma segura...'
  );
  await backupRemoteAuthBeforeShutdown(signal);
  await closeWhatsappBrowser();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdownForSignal('SIGTERM'));
process.once('SIGINT', () => void shutdownForSignal('SIGINT'));

void initializeClientWithRetry();
