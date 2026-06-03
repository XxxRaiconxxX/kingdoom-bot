import cron from 'node-cron';
import { supabase } from './supabase.js';
import { normalizePhone } from './adminStore.js';
import { getActiveProfile } from './activeProfileStore.js';
import { hydrateOpenTreasures, scheduleDailyTreasures } from './handlers/treasure.js';

// ✅ Timezone Paraguay (UTC-4, con ajuste horario de verano)
const TZ = { timezone: 'America/Asuncion' };

async function sendToAll(client, buildMessage) {
  const { data: players, error } = await supabase
    .from('players')
    .select('id, username, phone')
    .not('phone', 'is', null);

  if (error || !players?.length) return;

  const phoneMap = new Map();
  players.forEach(player => {
    if (player.phone) {
      player.phone.split(',').forEach(p => {
        const norm = normalizePhone(p.trim());
        if (norm) {
          if (!phoneMap.has(norm)) {
            phoneMap.set(norm, []);
          }
          phoneMap.get(norm).push(player);
        }
      });
    }
  });

  for (const [phone, linkedPlayers] of phoneMap.entries()) {
    try {
      const activeId = getActiveProfile(phone);
      let activePlayer = linkedPlayers.find(p => p.id === activeId) || linkedPlayers[0];

      const msg = typeof buildMessage === 'function' ? buildMessage({ phone, username: activePlayer.username }) : buildMessage;
      await client.sendMessage(`${phone}@c.us`, msg);
      await new Promise(r => setTimeout(r, 1500)); // anti-spam
    } catch (err) {
      console.error(`[scheduler] Error enviando a ${phone}:`, err.message);
    }
  }
}

export function startScheduler(client) {
  void hydrateOpenTreasures(client);

  // Programar los tesoros para el dia actual al iniciar (si aplica)
  scheduleDailyTreasures(client);

  // Reset diario — medianoche hora Paraguay
  cron.schedule('0 0 * * *', async () => {
    console.log('[scheduler] Enviando reset diario...');

    void hydrateOpenTreasures(client);

    // Programar los tesoros diarios del nuevo dia
    scheduleDailyTreasures(client);
    await sendToAll(client, ({ username }) => 
      `🌙 *La noche cae sobre el Reino de las Sombras...*\n\nSaludos, valiente *${username}*. Tus límites de juego se han reiniciado con el amanecer.\nLevántate, empuña tu arma y forja tu propio destino hoy. ¡A ganar oro, guerrero! ⚔️`
    );
  }, TZ);

  // Ranking semanal (reemplazado por Mensaje Motivacional) — lunes 9am hora Paraguay
  cron.schedule('0 9 * * 1', async () => {
    console.log('[scheduler] Enviando mensaje motivacional semanal...');

    await sendToAll(client, ({ username }) => 
      `🌅 *¡Un nuevo ciclo comienza en el reino!*\n\nEl Rey Supremo te observa, *${username}*. Las bestias son feroces, los caminos oscuros, pero tu leyenda apenas comienza a escribirse.\n\n_«Ni la magia más poderosa se compara con la voluntad de un aventurero que se niega a rendirse.»_\n\n¡Que los dioses de Kingdoom guíen tus pasos esta semana! 🛡️✨`
    );

    // Reset weekly_gold después de anunciar
    // Note: Supabase JS v2 requires at least one filter on mass updates.
    // Using .gte('weekly_gold', 0) to match all rows (gold is never negative).
    await supabase
      .from('players')
      .update({ weekly_gold: 0 })
      .gte('weekly_gold', 0);

    console.log('[scheduler] weekly_gold reseteado.');
  }, TZ);

  console.log('⏰ Scheduler iniciado (timezone: America/Asuncion)');
}
