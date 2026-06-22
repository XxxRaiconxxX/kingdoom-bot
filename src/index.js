import http from 'http';
import fs from 'fs';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import qrcodeImage from 'qrcode';
import 'dotenv/config';
import { handlePlayerMessage } from './handlers/player.js';
import { handleAdminCommand } from './handlers/admin.js';
import { handleCofre, handleDados, handleOraculo, handleTrampa } from './handlers/games.js';
import { buildWelcomeConfig, handleGroupWelcome } from './handlers/welcome.js';
import {
  registerPlayer,
  getPlayer,
  getPlayersByPhone,
  touchPlayerActivity,
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

let latestQrDataUrl = '';
let appStatus = 'Inicializando servidor...';
const welcomeConfig = buildWelcomeConfig();
let schedulerStarted = false;
let realtimeStarted = false;
const RESTRICTED_MINIGAME_GROUP_ID = '595971938097-1618930274@g.us';
const RESTRICTED_MINIGAME_SCOPE_KEY = 'main';
const RESTRICTED_MINIGAME_COMMANDS = new Set(['cofre', 'trampa', '21']);
const restrictedGroupLocks = new Map();

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

http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

  if (latestQrDataUrl) {
    res.end(`
      <html>
        <head>
          <title>Kingdoom Bot - Escanear QR</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="10">
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
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h2>Kingdoom Bot</h2>
            <p>Estado actual: <strong style="color: #ffc107;">${appStatus}</strong></p>
            <p>Escanea este codigo QR con WhatsApp:</p>
            <div class="qr-wrapper">
              <img src="${latestQrDataUrl}" />
            </div>
            <p style="color: #ffc107; font-weight: 500;">El QR se actualiza automaticamente cada 10 segundos.</p>
          </div>
        </body>
      </html>
    `);
  } else {
    res.end(`
      <html>
        <head>
          <title>Kingdoom Bot - Estado</title>
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <meta http-equiv="refresh" content="10">
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
            <p>Estado del sistema: <strong style="color: #4caf50;">${appStatus}</strong></p>
            <p>Si la pagina no carga el QR, el bot esta procesando la conexion o ya se conecto exitosamente.</p>
          </div>
        </body>
      </html>
    `);
  }
}).listen(parseInt(PORT, 10), '0.0.0.0', () => {
  console.log(`Servidor web activo en puerto ${PORT}`);
});

const authDataPath = process.env.PERSISTENT_DATA_PATH || '/app/.wwebjs_auth';

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: authDataPath }),
  authTimeoutMs: WHATSAPP_AUTH_TIMEOUT_MS,
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
  appStatus = 'Esperando escaneo de codigo QR...';
  qrcode.generate(qr, { small: true });

  try {
    latestQrDataUrl = await qrcodeImage.toDataURL(qr);
  } catch (err) {
    console.error('Error generating QR DataURL:', err);
  }
});

client.on('ready', async () => {
  console.log('Kingdoom Bot conectado');
  latestQrDataUrl = '';
  
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
    startScheduler(client);
    schedulerStarted = true;
  }

  if (!realtimeStarted) {
    startAuctionsRealtime(client);
    realtimeStarted = true;
  }
});

client.on('auth_failure', (message) => {
  console.error('[whatsapp auth_failure]', message);
  console.error('La sesión de WhatsApp es invalida o expiro. Borrando carpeta de autenticacion...');
  try {
    if (fs.existsSync(authDataPath)) {
      fs.rmSync(authDataPath, { recursive: true, force: true });
      console.log('Carpeta de autenticacion borrada. Reiniciando el proceso para generar un nuevo QR...');
    }
    process.exit(1);
  } catch (err) {
    console.error('Error al borrar la carpeta de autenticacion:', err);
  }
});

client.on('disconnected', (reason) => {
  console.warn('[whatsapp disconnected]', reason);
  schedulerStarted = false;
  try {
    clearTreasureTimeouts();
  } catch (e) {
    console.error('Error limpiando timeouts de tesoros', e);
  }
});

client.on('change_state', (state) => {
  console.log('[whatsapp state]', state);
});

client.on('group_join', async (notification) => {
  try {
    await handleGroupWelcome(notification, client, welcomeConfig);
  } catch (error) {
    console.error('[group_join]', error.message);
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

  const text = msg.body.trim();
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

      const resolution = registerGMResponse(trackerResult.shortId, aiResponse);
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

  const ADMIN_COMMANDS = ['grant', 'quitar', 'stats', 'ban', 'registrar', 'verificarnumero', 'desvincular', 'add', 'remove', 'admin', 'censo', 'fichas', 'pendientes', 'pendiente', 'purga', 'actividad', 'inactivos', 'groupid', 'grupos', 'grupoactual', 'staff', 'bitacora', 'data', 'misionstart'];
  const PRIVILEGED_COMMANDS = ['misioncompleta', 'faltasgrupo'];
  const isMarketSessionActive = !!getMarketForgeSession(msg.from, sender);
  const isMarketCommand = hasPrefix && (command === 'forjaritem' || (command === 'mercado' && body.toLowerCase().startsWith('crear')));
  const isPossibleAdminCmd = hasPrefix && (ADMIN_COMMANDS.includes(command) || PRIVILEGED_COMMANDS.includes(command));
  const isRestrictedMainGroupMinigame =
    hasPrefix &&
    msg.from === RESTRICTED_MINIGAME_GROUP_ID &&
    RESTRICTED_MINIGAME_COMMANDS.has(command);

  let isAdmin = false;
  let isStaff = false;
  let isPrivileged = false;

  if (isMarketSessionActive || isMarketCommand || isPossibleAdminCmd || isRestrictedMainGroupMinigame) {
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

    if (reply) await msg.reply(reply);
  } catch (err) {
    console.error('Error:', err);
    await msg.reply('El reino esta en llamas... intenta de nuevo en un momento.');
  }
});

async function initializeClientWithRetry() {
  for (let attempt = 1; attempt <= WHATSAPP_INIT_MAX_RETRIES; attempt += 1) {
    try {
      console.log(
        `[whatsapp init] Intento ${attempt}/${WHATSAPP_INIT_MAX_RETRIES} hacia web.whatsapp.com`
      );
      await client.initialize();
      return;
    } catch (err) {
      const formattedError = formatInitializeError(err);
      const isLastAttempt = attempt >= WHATSAPP_INIT_MAX_RETRIES;
      console.error(
        `[whatsapp init] Fallo intento ${attempt}/${WHATSAPP_INIT_MAX_RETRIES}: ${formattedError}`
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
          '[whatsapp init] Se agotaron los reintentos de inicializacion. Revisar conectividad del contenedor hacia https://web.whatsapp.com/.'
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
    process.exit(1);
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
    process.exit(1);
  }
});

void initializeClientWithRetry();
