import { getPlayer, updateGold, touchPlayerActivity } from '../supabase.js';

const TARGET_GROUP = '595971938097-1618930274@g.us';

// Almacena las sesiones activas indexadas por el ID de mensaje del cofre
export const activeTreasures = new Map();

// Guardar los temporizadores para poder limpiarlos si es necesario
let scheduledTimeouts = [];

// Obtener el desfase en milisegundos entre el reloj del servidor y la hora de Asunción, Paraguay
function getAsuncionOffsetMs() {
  const date = new Date();
  const asuncionStr = date.toLocaleString('en-US', { timeZone: 'America/Asuncion' });
  const asuncionDate = new Date(asuncionStr);
  return asuncionDate.getTime() - date.getTime();
}

/**
 * Lanza un evento sorpresa en el grupo principal
 */
export async function dropTreasure(client) {
  try {
    const maxWinners = Math.floor(Math.random() * 3) + 1; // 1 a 3 ganadores
    const goldAmountPerWinner = Math.floor(Math.random() * 10001) + 10000; // 10,000 a 20,000

    const text = `👑 *¡TESORO ERRANTE DEL REINO!* 👑\n\n` +
      `📦 Un cofre misterioso y resplandeciente ha aparecido en el camino real del Reino de las Sombras. ⚔️\n\n` +
      `✨ *Detalles del Tesoro:*\n` +
      `• Cupos de recompensa: *${maxWinners} valiente(s)*\n` +
      `• Recompensa individual: *${goldAmountPerWinner.toLocaleString('es-PY')} monedas de oro* 🪙\n\n` +
      `🛡️ *¿Cómo abrir el cofre?*\n` +
      `Para reclamar tu parte, debes **responder directamente (Reply) a este mensaje** con la palabra exacta:\n` +
      `👉 *reclamar*\n\n` +
      `⚠️ *Advertencia:* El cofre se desvanecerá en la niebla en *5 minutos*. ¡Rápido, aventureros!`;

    const message = await client.sendMessage(TARGET_GROUP, text);
    const quotedId = message.id._serialized;

    const treasureSession = {
      quotedId,
      maxWinners,
      winnersCount: 0,
      winnersList: [],
      goldAmountPerWinner,
      closed: false,
      lock: false
    };

    activeTreasures.set(quotedId, treasureSession);
    console.log(`[Treasure] Drop lanzado. ID: ${quotedId}, Cupos: ${maxWinners}, Oro: ${goldAmountPerWinner}`);

    // Programar el cierre del cofre a los 5 minutos
    setTimeout(() => {
      closeTreasure(quotedId, client);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('[Treasure Drop Error]', error);
  }
}

/**
 * Cierra la sesión del cofre por timeout
 */
async function closeTreasure(quotedId, client) {
  const treasure = activeTreasures.get(quotedId);
  if (!treasure || treasure.closed) return;

  treasure.closed = true;
  activeTreasures.delete(quotedId);

  try {
    const fadeMessage = `💨 *El cofre del tesoro errante se ha desvanecido en la niebla...*\n` +
      `Nadie logró reclamar las riquezas a tiempo. ¡Estad más atentos en el próximo viaje! 🗺️`;
    await client.sendMessage(TARGET_GROUP, fadeMessage);
    console.log(`[Treasure] Cofre ${quotedId} cerrado por inactividad.`);
  } catch (error) {
    console.error('[Treasure Close Error]', error);
  }
}

/**
 * Maneja las respuestas directas a los mensajes de tesoro
 */
export async function handleTreasureReply(msg, treasure, quotedId, client) {
  const text = msg.body.trim().toLowerCase();

  // Validar comando exacto
  if (text !== 'reclamar') return;

  // Si está cerrado, ignorar
  if (treasure.closed || treasure.winnersCount >= treasure.maxWinners) return;

  // Spin-lock básico para evitar race conditions
  if (treasure.lock) {
    let retries = 5;
    while (treasure.lock && retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 50));
      retries--;
    }
    if (treasure.lock) return; // Abortar si sigue bloqueado
  }

  treasure.lock = true;

  // Doble verificación tras adquirir el lock
  if (treasure.closed || treasure.winnersCount >= treasure.maxWinners) {
    treasure.lock = false;
    return;
  }

  try {
    const sender = msg.author || msg.from;
    const player = await getPlayer(sender);

    if (!player) {
      await msg.reply(`❌ *No estás registrado en los pergaminos del Reino.* \nEscribe *!registrar <nombre>* o hazlo a través de la web para poder reclamar tesoros.`);
      treasure.lock = false;
      return;
    }

    // Evitar que el mismo jugador gane dos veces en el mismo cofre
    if (treasure.winnersList.some(w => w.playerId === player.id)) {
      await msg.reply(`⚠️ *Ya has reclamado tu recompensa de este cofre, aventurero.*`);
      treasure.lock = false;
      return;
    }

    // Asignar premio
    treasure.winnersCount++;
    treasure.winnersList.push({ playerId: player.id, username: player.username });

    // Guardar en Supabase
    await updateGold(player.id, treasure.goldAmountPerWinner);
    await touchPlayerActivity(player.id);

    await msg.reply(`🎉 ¡Has abierto el cofre, *${player.username}*! Has ganado *+${treasure.goldAmountPerWinner.toLocaleString('es-PY')} monedas de oro* 🪙.`);

    // Si se completaron los ganadores, cerrar cofre
    if (treasure.winnersCount >= treasure.maxWinners) {
      treasure.closed = true;
      activeTreasures.delete(quotedId);

      const ganadoresNombres = treasure.winnersList.map(w => `*${w.username}*`).join(', ');
      await client.sendMessage(msg.from, `🔒 *El Cofre del Tesoro Errante se ha cerrado.* \n\nGanadores de esta expedición: ${ganadoresNombres}.\n¡Gracias por participar, aventureros! ⚔️`);
    }

  } catch (error) {
    console.error('[handleTreasureReply Error]', error);
    await msg.reply(`❌ Hubo un problema mágico al abrir el cofre. Inténtalo de nuevo.`);
    
    // Revertir en caso de fallo
    if (treasure.winnersList.length > 0) {
      const idx = treasure.winnersList.findIndex(w => w.playerId === player.id);
      if (idx !== -1) {
        treasure.winnersList.splice(idx, 1);
        treasure.winnersCount--;
      }
    }
  } finally {
    treasure.lock = false;
  }
}

/**
 * Programa los eventos sorpresa de tesoro diario
 */
export function scheduleDailyTreasures(client) {
  // Cancelar temporizadores existentes para evitar duplicaciones
  for (const t of scheduledTimeouts) {
    clearTimeout(t);
  }
  scheduledTimeouts = [];

  const now = new Date();
  const offsetMs = getAsuncionOffsetMs();
  const nowAsuncion = new Date(now.getTime() + offsetMs);

  const today10 = new Date(nowAsuncion);
  today10.setHours(10, 0, 0, 0);

  const today22 = new Date(nowAsuncion);
  today22.setHours(22, 0, 0, 0);

  const system10 = today10.getTime() - offsetMs;
  const system22 = today22.getTime() - offsetMs;

  // Programar de 1 a 2 eventos por día
  const numEvents = Math.floor(Math.random() * 2) + 1;
  console.log(`[Treasure] Programando ${numEvents} evento(s) para hoy.`);

  const eventTimes = [];
  for (let i = 0; i < numEvents; i++) {
    const randomTime = system10 + Math.random() * (system22 - system10);
    eventTimes.push(randomTime);
  }

  eventTimes.sort((a, b) => a - b);

  for (const time of eventTimes) {
    const delay = time - now.getTime();
    if (delay > 0) {
      const dateTargetStr = new Date(time + offsetMs).toLocaleTimeString('es-PY', { hour12: false });
      console.log(`[Treasure] Evento programado a las ${dateTargetStr} hora Paraguay (en ${Math.round(delay / 60000)} minutos).`);
      
      const t = setTimeout(() => {
        dropTreasure(client);
      }, delay);
      scheduledTimeouts.push(t);
    } else {
      console.log(`[Treasure] Omitiendo evento programado en el pasado.`);
    }
  }
}
