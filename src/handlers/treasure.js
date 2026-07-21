import {
  claimTreasureReward,
  closeTreasureEvent,
  createTreasureEvent,
  expireTreasureEvent,
  getOpenTreasureEvents,
  getPlayer,
  getTreasureClaims,
  touchPlayerActivity,
} from '../supabase.js';
import { waitForMessageServerAck } from '../whatsappDelivery.js';
import { heraldCard, heraldStat } from '../formatting.js';

const TARGET_GROUP = '595971938097-1618930274@g.us';
const TREASURE_DURATION_MS = 5 * 60 * 1000;
const TREASURE_START_HOUR = 10;
const TREASURE_END_HOUR = 22;
const TREASURE_HEALTH_RETRY_MS = 5 * 60 * 1000;

export const activeTreasures = new Map();

let scheduledTimeouts = [];
const treasureClaimLocks = new Map();

function runTreasureClaimSerial(messageId, task) {
  // ponytail: Safe for the single Space process; use a transactional RPC before adding bot replicas.
  const previous = treasureClaimLocks.get(messageId) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  treasureClaimLocks.set(messageId, current);

  return current.finally(() => {
    if (treasureClaimLocks.get(messageId) === current) {
      treasureClaimLocks.delete(messageId);
    }
  });
}

export function clearTreasureTimeouts() {
  for (const timeoutId of scheduledTimeouts) {
    clearTimeout(timeoutId);
  }
  scheduledTimeouts = [];
}

function randomIntInclusive(min, max) {
  const safeMin = Math.ceil(min);
  const safeMax = Math.floor(max);
  return safeMin + Math.floor(Math.random() * (safeMax - safeMin + 1));
}

function getAsuncionOffsetMs() {
  const date = new Date();
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Asuncion',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const partsMap = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        partsMap[part.type] = parseInt(part.value, 10);
      }
    }

    const asuncionUTC = Date.UTC(
      partsMap.year,
      partsMap.month - 1,
      partsMap.day,
      partsMap.hour === 24 ? 0 : partsMap.hour,
      partsMap.minute,
      partsMap.second
    );

    const systemUTC = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds()
    );

    return asuncionUTC - systemUTC;
  } catch (error) {
    console.error('[Treasure] Error al calcular zona horaria de Asuncion, usando fallback -4h:', error);
    return -4 * 60 * 60 * 1000;
  }
}

function formatGold(value) {
  return Number(value ?? 0).toLocaleString('es-PY');
}

function normalizeTreasureReply(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\*/g, '')
    .replace(/^!\s*/, '')
    .trim();
}

export async function waitForTreasureAckBestEffort(client, message) {
  try {
    await waitForMessageServerAck(client, message);
    return true;
  } catch (error) {
    console.warn(
      '[Treasure] ACK no confirmado; el evento persistido seguira disponible:',
      error?.message ?? error
    );
    return false;
  }
}

export function buildTreasureClaimFeedback(status, details = {}) {
  const playerName = details.playerName || 'Aventurero';

  if (status === 'duplicate') {
    return heraldCard('Reclamo ya registrado', [
      `*${playerName}*, tu reclamo ya figura en este tesoro.`,
      'No se procesara un segundo pago. Revisa tu saldo si la respuesta anterior quedo pendiente.',
    ], { icon: '⚠️' });
  }

  if (status === 'credit_pending') {
    return heraldCard('Tesoro · Acreditacion pendiente', [
      `*${playerName}*, tu cupo quedo reservado sin duplicar el reclamo.`,
      heraldStat('Recompensa reservada', `${formatGold(details.rewardGold)} oro`),
      'La base de datos no confirmo el abono. Revisa tu saldo y no vuelvas a reclamar este tesoro.',
    ], { icon: '⚠️' });
  }

  if (status === 'expired') {
    return heraldCard('Tesoro desvanecido', [
      'El tiempo limite termino antes de confirmar tu reclamo.',
      'No se acredito ninguna recompensa.',
    ], { icon: '⌛' });
  }

  if (status === 'full' || status === 'claimed') {
    return heraldCard('Tesoro agotado', [
      'Los cupos de este Tesoro Errante ya fueron ocupados.',
      'No se acredito ninguna recompensa en este intento.',
    ], { icon: '⌛' });
  }

  if (status === 'ok') {
    return heraldCard('Tesoro reclamado', [
      `> _*${playerName}* abrio el cofre entre las sombras._`,
      heraldStat('Recompensa acreditada', `+${formatGold(details.rewardGold)} oro`),
      details.currentGold === null || details.currentGold === undefined
        ? ''
        : heraldStat('Nuevo total', `${formatGold(details.currentGold)} oro`),
    ].filter(Boolean), { icon: '🎉' });
  }

  return heraldCard('Reclamo no confirmado', [
    'Ocurrio un problema al registrar el reclamo.',
    'No se anunciara una ganancia sin confirmacion de la base de datos. Intenta nuevamente mientras el tesoro siga abierto.',
  ], { icon: '⚠️' });
}

function registerActiveTreasure(event, client, isClientReady) {
  const existing = activeTreasures.get(event.message_id);
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  const remainingMs = Math.max(0, new Date(event.expires_at).getTime() - Date.now());
  const timeoutId = setTimeout(() => {
    void closeTreasure(event.message_id, client, { reason: 'expired', isClientReady });
  }, remainingMs);

  activeTreasures.set(event.message_id, {
    messageId: event.message_id,
    chatId: event.chat_id,
    maxWinners: event.max_winners,
    status: event.status,
    createdAt: event.created_at,
    expiresAt: event.expires_at,
    isClientReady,
    timeoutId,
  });
}

async function buildClaimsSummary(messageId) {
  const claims = await getTreasureClaims(messageId);
  if (!claims.length) {
    return null;
  }

  const winnerLines = claims.map(
    (claim) => `- ${claim.playerName}: ${formatGold(claim.rewardGold)} oro`
  );

  return [
    '*Tesoro reclamado*',
    '',
    'Ganadores del Tesoro Errante:',
    ...winnerLines,
    '',
    'El tesoro ha sido vaciado.',
  ].join('\n');
}

export async function dropTreasure(client, isClientReady = () => Boolean(client?.info)) {
  try {
    if (!isClientReady()) {
      console.log('[Treasure] Canal de WhatsApp no saludable. Omitiendo drop.');
      return null;
    }

    if ([...activeTreasures.values()].some((treasure) => treasure.chatId === TARGET_GROUP)) {
      console.log('[Treasure] Ya existe un tesoro abierto en el grupo principal; se omite este disparo.');
      return null;
    }

    const maxWinners = randomIntInclusive(1, 3);
    const text =
      `🎁 *Tesoro Errante del Reino*\n\n` +
      `Una recompensa cayo entre las sombras.\n\n` +
      `Responde a ESTE mensaje con:\n` +
      `*reclamar*\n\n` +
      `⏳ Tiempo limite: 5 minutos\n` +
      `🏆 Ganadores posibles: ${maxWinners}`;

    let message;
    try {
      const chat = await client.getChatById(TARGET_GROUP);
      message = await chat.sendMessage(text);
    } catch (err) {
      console.log('[Treasure] getChatById fallo; intentando envio directo.');
      message = await client.sendMessage(TARGET_GROUP, text);
    }
    const messageId = message?.id?._serialized || message?.id?.id;
    if (!messageId) {
      throw new Error('WhatsApp no devolvio el ID del mensaje de tesoro.');
    }
    const expiresAt = new Date(Date.now() + TREASURE_DURATION_MS).toISOString();

    // Register active treasure in memory map immediately to avoid race conditions
    const tempEvent = {
      message_id: messageId,
      chat_id: TARGET_GROUP,
      max_winners: maxWinners,
      status: 'open',
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
    };
    registerActiveTreasure(tempEvent, client, isClientReady);

    const event = await createTreasureEvent({
      chatId: TARGET_GROUP,
      messageId,
      maxWinners,
      expiresAt,
    });

    registerActiveTreasure(event, client, isClientReady);
    const ackConfirmed = await waitForTreasureAckBestEffort(client, message);
    console.log(
      `[Treasure] Drop persistido. Cupos: ${event.max_winners}. ACK: ${ackConfirmed ? 'confirmado' : 'pendiente'}.`
    );
    return event;
  } catch (error) {
    console.error('[Treasure Drop Error] Detalle completo:', error.stack || error);
    return null;
  }
}

export async function closeTreasure(messageId, client, options = {}) {
  const {
    reason = 'expired',
    skipStatusUpdate = false,
    isClientReady = () => Boolean(client?.info),
  } = options;
  const cached = activeTreasures.get(messageId);
  if (cached?.timeoutId) {
    clearTimeout(cached.timeoutId);
  }
  // Si WhatsApp no esta operativo, reprogramamos el cierre para dentro de 1 minuto
  // sin actualizar el estado en base de datos para no perder el aviso
  if (!isClientReady()) {
    console.log('[Treasure] Canal de WhatsApp no saludable. Re-programando cierre para en 1 minuto.');
    const retryTimeoutId = setTimeout(() => {
      void closeTreasure(messageId, client, options);
    }, 60000);
    if (cached) {
      activeTreasures.set(messageId, { ...cached, timeoutId: retryTimeoutId });
    }
    return;
  }

  if (reason === 'claimed' && cached) {
    activeTreasures.set(messageId, { ...cached, status: 'closing', timeoutId: null });
  }

  try {
    if (!skipStatusUpdate) {
      if (reason === 'expired') {
        await expireTreasureEvent(messageId);
      } else if (reason === 'claimed') {
        await closeTreasureEvent(messageId);
      }
    }

    const targetChat = cached?.chatId || TARGET_GROUP;
    const summary = await buildClaimsSummary(messageId);
    let closeMessage = null;
    if (summary) {
      closeMessage = await client.sendMessage(targetChat, summary);
    } else if (reason === 'expired') {
      closeMessage = await client.sendMessage(
        targetChat,
        '*El Tesoro Errante se desvanecio*\n\nEl tiempo termino y ya no quedan recompensas por reclamar.'
      );
    }
    if (closeMessage) {
      await waitForMessageServerAck(client, closeMessage);
    }
  } catch (error) {
    console.error('[Treasure Close Error]', error);
  } finally {
    const remainingMs = cached
      ? Math.max(0, new Date(cached.expiresAt).getTime() - Date.now())
      : 0;
    if (reason === 'claimed' && cached && remainingMs > 0) {
      const timeoutId = setTimeout(() => activeTreasures.delete(messageId), remainingMs);
      activeTreasures.set(messageId, { ...cached, status: 'claimed', timeoutId });
    } else {
      activeTreasures.delete(messageId);
    }
  }
}

export async function handleTreasureReply(msg, treasure, quotedId, client) {
  if (!treasure) {
    return null;
  }

  const targetGroup = treasure.chatId || TARGET_GROUP;
  if (msg.from !== targetGroup && msg.from !== TARGET_GROUP) {
    return null;
  }

  const text = normalizeTreasureReply(msg.body);
  if (text !== 'reclamar') {
    return null;
  }

  if (treasure.status !== 'open') {
    return buildTreasureClaimFeedback('full');
  }

  if (typeof msg.react === 'function') {
    void msg.react('\u23F3').catch((reactionError) => {
      console.warn('[Treasure] No se pudo marcar el reclamo como recibido:', reactionError?.message ?? reactionError);
    });
  }

  const sender = msg.author || msg.from;
  let player;
  try {
    player = await getPlayer(sender);
  } catch (playerError) {
    console.error('[Treasure] No se pudo resolver al jugador:', playerError);
    return heraldCard('Reclamo no confirmado', [
      'No pude verificar tu perfil en este momento.',
      'No se proceso ninguna recompensa. Intenta nuevamente.',
    ], { icon: '⚠️' });
  }
  if (!player) {
    return heraldCard('Reclamo rechazado', [
      'No estas registrado en los pergaminos del Reino.',
      'Pide al staff que use `!registrar <nombre>` para poder reclamar tesoros.',
    ], { icon: '❌' });
  }

  try {
    const result = await runTreasureClaimSerial(
      quotedId,
      () => claimTreasureReward(quotedId, player.id, targetGroup)
    );
    const status = result?.status ?? 'error';

    if (status === 'duplicate') {
      return buildTreasureClaimFeedback(status, { playerName: player.username });
    }

    if (status === 'credit_pending') {
      return buildTreasureClaimFeedback(status, {
        playerName: player.username,
        rewardGold: result.reward_gold,
      });
    }

    if (status === 'expired') {
      void closeTreasure(quotedId, client, {
        reason: 'expired',
        skipStatusUpdate: false,
        isClientReady: treasure.isClientReady,
      });
      return buildTreasureClaimFeedback(status);
    }

    if (status === 'full' || status === 'claimed') {
      void closeTreasure(quotedId, client, {
        reason: 'claimed',
        skipStatusUpdate: false,
        isClientReady: treasure.isClientReady,
      });
      return buildTreasureClaimFeedback(status);
    }

    if (status !== 'ok') {
      console.error(`[Treasure] Reclamo no confirmado. status=${status} reason=${result?.reason ?? 'unknown'}`);
      return buildTreasureClaimFeedback(status);
    }

    void touchPlayerActivity(player.id).catch((activityError) => {
      console.error('[Treasure] Error no critico al registrar actividad del jugador:', activityError);
    });

    const projectedGold = Number(player.gold) + Number(result.reward_gold);
    const currentGold = Number.isFinite(projectedGold) ? projectedGold : null;

    if (['claimed', 'close_pending'].includes(result.event_status) || result.winners_count >= result.max_winners) {
      void closeTreasure(quotedId, client, {
        reason: 'claimed',
        skipStatusUpdate: result.event_status === 'claimed',
        isClientReady: treasure.isClientReady,
      });
    }

    return buildTreasureClaimFeedback('ok', {
      playerName: player.username,
      rewardGold: result.reward_gold,
      currentGold,
    });
  } catch (error) {
    console.error('[handleTreasureReply Error]', error);
    return heraldCard('Reclamo interrumpido', [
      'Hubo un problema al procesar el Tesoro Errante.',
      'No se confirmara ninguna ganancia hasta verificar la operacion. Intenta nuevamente.',
    ], { icon: '❌' });
  }
}

export async function hydrateOpenTreasures(client, isClientReady = () => Boolean(client?.info)) {
  try {
    const openEvents = await getOpenTreasureEvents(TARGET_GROUP);
    for (const event of openEvents) {
      const expiresAtMs = new Date(event.expires_at).getTime();
      if (expiresAtMs <= Date.now()) {
        await closeTreasure(event.message_id, client, { reason: 'expired', isClientReady });
        continue;
      }

      registerActiveTreasure(event, client, isClientReady);
    }

    console.log(`[Treasure] Rehidratados ${openEvents.length} evento(s) abiertos desde Supabase.`);
  } catch (error) {
    console.error('[Treasure] Error rehidratando eventos abiertos:', error);
  }
}

export function scheduleDailyTreasures(client, isClientReady = () => Boolean(client?.info)) {
  for (const timeoutId of scheduledTimeouts) {
    clearTimeout(timeoutId);
  }
  scheduledTimeouts = [];

  const now = new Date();
  const offsetMs = getAsuncionOffsetMs();
  const nowAsuncion = new Date(now.getTime() + offsetMs);

  const today10 = new Date(nowAsuncion);
  today10.setHours(TREASURE_START_HOUR, 0, 0, 0);

  const today22 = new Date(nowAsuncion);
  today22.setHours(TREASURE_END_HOUR, 0, 0, 0);

  const system10 = today10.getTime() - offsetMs;
  const system22 = today22.getTime() - offsetMs;

  const numEvents = Math.floor(Math.random() * 3) + 2;
  console.log(`[Treasure] Programando ${numEvents} evento(s) para hoy.`);

  const eventTimes = [];
  for (let i = 0; i < numEvents; i += 1) {
    const randomTime = system10 + Math.random() * (system22 - system10);
    eventTimes.push(randomTime);
  }

  eventTimes.sort((left, right) => left - right);

  for (const time of eventTimes) {
    const delay = time - now.getTime();
    if (delay <= 0) {
      console.log('[Treasure] Omitiendo evento programado en el pasado.');
      continue;
    }

    const dateTargetStr = new Date(time + offsetMs).toLocaleTimeString('es-PY', { hour12: false });
    console.log(
      `[Treasure] Evento programado a las ${dateTargetStr} hora Paraguay (en ${Math.round(delay / 60000)} minutos).`
    );

    const runDrop = () => {
      if (!isClientReady() && Date.now() + TREASURE_HEALTH_RETRY_MS < system22) {
        const retryId = setTimeout(runDrop, TREASURE_HEALTH_RETRY_MS);
        scheduledTimeouts.push(retryId);
        return;
      }
      void dropTreasure(client, isClientReady);
    };
    const timeoutId = setTimeout(runDrop, delay);

    scheduledTimeouts.push(timeoutId);
  }
}
