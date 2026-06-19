import crypto from 'crypto';

import {
  claimTreasureReward,
  createTreasureEvent,
  expireTreasureEvent,
  getOpenTreasureEvents,
  getPlayer,
  getTreasureClaims,
  touchPlayerActivity,
} from '../supabase.js';

const TARGET_GROUP = process.env.TARGET_GROUP_ID;
const TREASURE_DURATION_MS = 5 * 60 * 1000;
const TREASURE_START_HOUR = 10;
const TREASURE_END_HOUR = 22;

export const activeTreasures = new Map();

let scheduledTimeouts = [];

export function clearTreasureTimeouts() {
  for (const timeoutId of scheduledTimeouts) {
    clearTimeout(timeoutId);
  }
  scheduledTimeouts = [];
}

function randomIntInclusive(min, max) {
  const safeMin = Math.ceil(min);
  const safeMax = Math.floor(max);
  return crypto.randomInt(safeMin, safeMax + 1);
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
    .replace(/\*/g, '');
}

function registerActiveTreasure(event, client) {
  const existing = activeTreasures.get(event.message_id);
  if (existing?.timeoutId) {
    clearTimeout(existing.timeoutId);
  }

  const remainingMs = Math.max(0, new Date(event.expires_at).getTime() - Date.now());
  const timeoutId = setTimeout(() => {
    void closeTreasure(event.message_id, client, { reason: 'expired' });
  }, remainingMs);

  activeTreasures.set(event.message_id, {
    messageId: event.message_id,
    chatId: event.chat_id,
    maxWinners: event.max_winners,
    status: event.status,
    createdAt: event.created_at,
    expiresAt: event.expires_at,
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

export async function dropTreasure(client) {
  try {
    if (!client || !client.info) {
      console.log('[Treasure] Cliente no inicializado o en estado zombie. Omitiendo drop.');
      return null;
    }

    if (!TARGET_GROUP) {
      console.warn('[Treasure] TARGET_GROUP_ID no está configurado. Omitiendo drop.');
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
      console.log(`[Treasure] getChatById failed, attempting fallback client.sendMessage... (${err.message})`);
      message = await client.sendMessage(TARGET_GROUP, text);
    }

    const expiresAt = new Date(Date.now() + TREASURE_DURATION_MS).toISOString();
    const event = await createTreasureEvent({
      chatId: TARGET_GROUP,
      messageId: message.id._serialized,
      maxWinners,
      expiresAt,
    });

    registerActiveTreasure(event, client);
    console.log(`[Treasure] Drop persistido. ID mensaje: ${event.message_id}, cupos: ${event.max_winners}`);
    return event;
  } catch (error) {
    console.error('[Treasure Drop Error] Detalle completo:', error.stack || error);
    return null;
  }
}

export async function closeTreasure(messageId, client, options = {}) {
  const { reason = 'expired', skipStatusUpdate = false } = options;

  if (!TARGET_GROUP) {
    console.warn('[Treasure] TARGET_GROUP_ID no está configurado. Omitiendo mensaje de cierre.');
  }

  const cached = activeTreasures.get(messageId);
  if (cached?.timeoutId) {
    clearTimeout(cached.timeoutId);
  }

  try {
    if (!skipStatusUpdate && reason === 'expired') {
      await expireTreasureEvent(messageId);
    }

    if (!client || !client.info) {
      console.log('[Treasure] Cliente no inicializado o en estado zombie. Omitiendo mensaje de cierre.');
      return;
    }

    if (TARGET_GROUP) {
      const summary = await buildClaimsSummary(messageId);
      if (summary) {
        await client.sendMessage(TARGET_GROUP, summary);
      } else if (reason === 'expired') {
        await client.sendMessage(
          TARGET_GROUP,
          '*El Tesoro Errante se desvanecio*\n\nEl tiempo termino y ya no quedan recompensas por reclamar.'
        );
      }
    }
  } catch (error) {
    console.error('[Treasure Close Error]', error);
  } finally {
    activeTreasures.delete(messageId);
  }
}

export async function handleTreasureReply(msg, treasure, quotedId, client) {
  if (msg.from !== TARGET_GROUP || !treasure) {
    return;
  }

  const text = normalizeTreasureReply(msg.body);
  if (text !== 'reclamar') {
    return;
  }

  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);
  if (!player) {
    await msg.reply(
      '❌ *No estas registrado en los pergaminos del Reino.*\nEscribe *!registrar <nombre>* o hazlo desde la web para poder reclamar tesoros.'
    );
    return;
  }

  try {
    const result = await claimTreasureReward(quotedId, player.id, TARGET_GROUP);
    const status = result?.status ?? 'error';

    if (status === 'duplicate') {
      await msg.reply('⚠️ *Ya has reclamado una recompensa de este tesoro, aventurero.*');
      return;
    }

    if (status === 'expired') {
      await closeTreasure(quotedId, client, { reason: 'expired', skipStatusUpdate: true });
      return;
    }

    if (status === 'full' || status === 'claimed') {
      await closeTreasure(quotedId, client, { reason: 'claimed', skipStatusUpdate: true });
      return;
    }

    if (status !== 'ok') {
      return;
    }

    try {
      await touchPlayerActivity(player.id);
    } catch (activityError) {
      console.error('[Treasure] Error no critico al registrar actividad del jugador:', activityError);
    }

    await msg.reply(
      `🎉 ¡Has abierto el cofre, *${player.username}*! Has ganado *+${formatGold(result.reward_gold)} monedas de oro* 🪙.`
    );

    if (result.event_status === 'claimed' || result.winners_count >= result.max_winners) {
      await closeTreasure(quotedId, client, { reason: 'claimed', skipStatusUpdate: true });
    }
  } catch (error) {
    console.error('[handleTreasureReply Error]', error);
    await msg.reply('❌ Hubo un problema magico al abrir el cofre. Intentalo de nuevo.');
  }
}

export async function hydrateOpenTreasures(client) {
  try {
    const openEvents = await getOpenTreasureEvents(TARGET_GROUP);
    for (const event of openEvents) {
      const expiresAtMs = new Date(event.expires_at).getTime();
      if (expiresAtMs <= Date.now()) {
        await closeTreasure(event.message_id, client, { reason: 'expired' });
        continue;
      }

      registerActiveTreasure(event, client);
    }

    console.log(`[Treasure] Rehidratados ${openEvents.length} evento(s) abiertos desde Supabase.`);
  } catch (error) {
    console.error('[Treasure] Error rehidratando eventos abiertos:', error);
  }
}

export function scheduleDailyTreasures(client) {
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

  const numEvents = crypto.randomInt(0, 3) + 2;
  console.log(`[Treasure] Programando ${numEvents} evento(s) para hoy.`);

  const eventTimes = [];
  for (let i = 0; i < numEvents; i += 1) {
    const randomTime = system10 + crypto.randomInt(0, Math.floor(system22 - system10) + 1);
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

    const timeoutId = setTimeout(() => {
      void dropTreasure(client);
    }, delay);

    scheduledTimeouts.push(timeoutId);
  }
}
