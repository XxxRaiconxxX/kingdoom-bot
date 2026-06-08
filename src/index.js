import http from 'http';
import { spawn } from 'child_process';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import qrcodeImage from 'qrcode';
import 'dotenv/config';
import { handlePlayerMessage } from './handlers/player.js';
import { handleAdminCommand } from './handlers/admin.js';
import { handleCofre, handleDados, handleOraculo, handleTrampa } from './handlers/games.js';
import { buildWelcomeConfig, handleGroupWelcome } from './handlers/welcome.js';
import { registerPlayer, getPlayer, getPlayersByPhone, touchPlayerActivity, getMissionsWithMissingNotebooks, updateMissionNotebookId } from './supabase.js';
import { startScheduler } from './scheduler.js';
import { isAdminUser, isStaffUser, normalizePhone } from './adminStore.js';
import { processTrackerMessage, buildGMPrompt, buildGMUserPayload, registerGMResponse, buildVisibleGMResponse, assessGMResponse, buildFallbackCompletedGMResponse, setMissionConversationId } from './gmTracker.js';
import { askKingdoomAI } from './ai.js';
import { handleMarketForgeConversation } from './handlers/marketForge.js';
import { handleBlackjack, handleBlackjackReply, activeSessions } from './handlers/blackjack.js';
import { activeTreasures, handleTreasureReply } from './handlers/treasure.js';

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
const welcomeConfig = buildWelcomeConfig();
let schedulerStarted = false;

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
          <style>
            body {
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              height: 100vh;
              margin: 0;
              background: #121214;
              color: #ffffff;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            }
            .container {
              text-align: center;
              background: #1a1a1e;
              padding: 30px;
              border-radius: 16px;
              box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
              max-width: 90%;
              width: 360px;
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
            img {
              width: 250px;
              height: 250px;
              display: block;
            }
            p {
              color: #a3a3a8;
              font-size: 14px;
              margin: 10px 0 0 0;
            }
          </style>
          <script>
            setTimeout(() => {
              window.location.reload();
            }, 10000);
          </script>
        </head>
        <body>
          <div class="container">
            <h2>Kingdoom Bot</h2>
            <p>Escanea este codigo QR con WhatsApp:</p>
            <div class="qr-wrapper">
              <img src="${latestQrDataUrl}" />
            </div>
            <p style="color: #ffc107; font-weight: 500;">El QR se actualiza automaticamente cada 10 segundos.</p>
          </div>
        </body>
      </html>
    `);
    return;
  }

  res.end(`
    <html>
      <head>
        <title>Kingdoom Bot - Activo</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            background: #121214;
            color: #ffffff;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          }
          .container {
            text-align: center;
            background: #1a1a1e;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
            max-width: 90%;
            width: 360px;
          }
          h2 {
            margin-top: 0;
            color: #4cd964;
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
          <h2>Bot Conectado</h2>
          <p>El Archivista confirma que <strong>Kingdoom Bot</strong> esta activo y respondiendo mensajes en WhatsApp.</p>
        </div>
      </body>
    </html>
  `);
}).listen(PORT, () => {
  console.log(`Servidor web activo en puerto ${PORT}`);
});

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: '/app/.wwebjs_auth' }),
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
      '--disable-extensions',
      '--disable-accelerated-2d-canvas',
    ],
  },
});

client.on('qr', async (qr) => {
  console.log('Escanea este QR:');
  qrcode.generate(qr, { small: true });

  try {
    latestQrDataUrl = await qrcodeImage.toDataURL(qr);
  } catch (err) {
    console.error('Error generating QR DataURL:', err);
  }
});

client.on('ready', () => {
  console.log('Kingdoom Bot conectado');
  latestQrDataUrl = '';
  if (!schedulerStarted) {
    startScheduler(client);
    schedulerStarted = true;
  }
  autoProvisionMissions().catch(err => {
    console.error('Error running auto-provisioning on startup:', err);
  });
});

client.on('auth_failure', (message) => {
  console.error('[whatsapp auth_failure]', message);
});

client.on('disconnected', (reason) => {
  console.warn('[whatsapp disconnected]', reason);
  schedulerStarted = false;
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

function askNotebookLM(notebookId, prompt, conversationId = null) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', ['src/scripts/notebooklm_helper.py']);
    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python process exited with code ${code}. Stderr: ${stderrData}`));
      }
      try {
        const result = JSON.parse(stdoutData.trim());
        if (result.error) {
          return reject(new Error(result.error));
        }
        resolve(result);
      } catch (err) {
        reject(new Error(`Failed to parse Python stdout: ${stdoutData}. Error: ${err.message}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn Python process: ${err.message}`));
    });

    // Write input JSON to stdin
    const inputPayload = JSON.stringify({
      notebook_id: notebookId,
      conversation_id: conversationId,
      prompt: prompt
    });
    pythonProcess.stdin.write(inputPayload);
    pythonProcess.stdin.end();
  });
}

async function autoProvisionMissions() {
  const cookies = process.env.NOTEBOOKLM_COOKIES;
  if (!cookies) {
    console.warn('[NotebookLM Auto-Provision] NOTEBOOKLM_COOKIES no está configurado. Se omite la auto-creación.');
    return;
  }

  console.log('[NotebookLM Auto-Provision] Buscando misiones sin libreta de NotebookLM...');
  try {
    const missions = await getMissionsWithMissingNotebooks();
    if (missions.length === 0) {
      console.log('[NotebookLM Auto-Provision] Todas las misiones ya tienen libreta de NotebookLM.');
      return;
    }

    console.log(`[NotebookLM Auto-Provision] Se encontraron ${missions.length} misiones pendientes de libreta.`);
    const gmPrompt = buildGMPrompt();

    for (const mission of missions) {
      console.log(`[NotebookLM Auto-Provision] Creando libreta para: "${mission.title}"...`);
      try {
        const notebookId = await provisionNotebook(mission.title, mission.instructions, gmPrompt);
        if (notebookId) {
          const success = await updateMissionNotebookId(mission.id, notebookId);
          if (success) {
            console.log(`[NotebookLM Auto-Provision] ✅ Misión "${mission.title}" vinculada con éxito al Notebook ID: ${notebookId}`);
          }
        }
      } catch (err) {
        console.error(`[NotebookLM Auto-Provision] ❌ Error creando libreta para "${mission.title}":`, err.message);
      }
    }
  } catch (err) {
    console.error('[NotebookLM Auto-Provision] Error en el proceso de auto-provisión:', err.message);
  }
}

function provisionNotebook(title, instructions, gmPrompt) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python3', ['src/scripts/notebooklm_provisioner.py']);
    let stdoutData = '';
    let stderrData = '';

    pythonProcess.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Python provision process exited with code ${code}. Stderr: ${stderrData}`));
      }
      try {
        const result = JSON.parse(stdoutData.trim());
        if (result.error) {
          return reject(new Error(result.error));
        }
        resolve(result.notebook_id);
      } catch (err) {
        reject(new Error(`Failed to parse Python stdout: ${stdoutData}. Error: ${err.message}`));
      }
    });

    pythonProcess.on('error', (err) => {
      reject(new Error(`Failed to spawn Python provision process: ${err.message}`));
    });

    // Write input JSON to stdin
    const inputPayload = JSON.stringify({
      title: title,
      instructions: instructions,
      gm_prompt: gmPrompt
    });
    pythonProcess.stdin.write(inputPayload);
    pythonProcess.stdin.end();
  });
}

const activityCache = new Map();

client.on('message', async (msg) => {
  if (msg.fromMe || msg.isStatus) return;

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
          await handleTreasureReply(msg, treasure, quotedId);
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

      let aiResponse = '';
      let usedNotebookLM = false;

      if (trackerResult.notebookId) {
        console.log(`[GM Tracker] Iniciando consulta a NotebookLM para la misión ${trackerResult.shortId} (Notebook: ${trackerResult.notebookId})`);
        try {
          const combinedPrompt = `${gmPrompt}\n\n${gmUserPayload}`;
          const notebookResult = await askNotebookLM(
            trackerResult.notebookId,
            combinedPrompt,
            trackerResult.conversationId
          );
          
          if (notebookResult && notebookResult.answer) {
            aiResponse = notebookResult.answer;
            if (notebookResult.conversation_id) {
              setMissionConversationId(trackerResult.shortId, notebookResult.conversation_id);
              console.log(`[GM Tracker] ID de conversación actualizado/guardado: ${notebookResult.conversation_id}`);
            }
            usedNotebookLM = true;
          }
        } catch (notebookErr) {
          console.warn(`[GM Tracker] Error al consultar NotebookLM: ${notebookErr.message}. Realizando fallback a Gemini estándar.`);
        }
      }

      if (!usedNotebookLM) {
        const history = [{ role: 'user', content: gmUserPayload }];
        aiResponse = await askKingdoomAI(history, gmPrompt, {
          maxEstimatedInputTokens: 6000,
          maxOutputTokens: 2048,
        });
      }

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

  const nowMs = Date.now();
  if (!activityCache.has(sender) || (nowMs - activityCache.get(sender)) > 5 * 60 * 1000) {
    activityCache.set(sender, nowMs);
    getPlayersByPhone(sender).then((players) => {
      players.forEach((player) => {
        if (player && player.id) {
          touchPlayerActivity(player.id).catch(console.error);
        }
      });
    }).catch(console.error);
  }

  const checkIsAdmin = async (user) => {
    if (isAdminUser(user)) return true;
    try {
      const players = await getPlayersByPhone(user);
      return players.some((player) => player?.is_admin === true);
    } catch (err) {
      console.error('[checkIsAdmin] Error checking DB:', err);
      return false;
    }
  };

  const isAdmin = await checkIsAdmin(sender);
  const isStaff = isStaffUser(sender);
  const isPrivileged = isAdmin || isStaff;
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
    } else if (!hasPrefix) {
      return;
    } else if (isAdmin && ['grant', 'quitar', 'stats', 'ban', 'registrar', 'verificarnumero', 'desvincular', 'add', 'remove', 'admin', 'censo', 'fichas', 'pendientes', 'pendiente', 'purga', 'actividad', 'inactivos', 'groupid', 'grupos', 'grupoactual', 'staff', 'bitacora', 'data', 'misionstart'].includes(command)) {
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
});

process.on('uncaughtException', (error) => {
  const formattedError = formatInitializeError(error);
  console.error(`[process uncaughtException] ${formattedError}`);
});

void initializeClientWithRetry();
