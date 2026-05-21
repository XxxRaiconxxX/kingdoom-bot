import cron from 'node-cron';
import { supabase } from './supabase.js';
import { normalizePhone } from './adminStore.js';

// ✅ Timezone Paraguay (UTC-4, con ajuste horario de verano)
const TZ = { timezone: 'America/Asuncion' };

async function sendToAll(client, buildMessage) {
  const { data: players, error } = await supabase
    .from('players')
    .select('phone')
    .not('phone', 'is', null);

  if (error || !players?.length) return;

  const uniquePhones = [...new Set(
    players
      .map((player) => normalizePhone(player.phone))
      .filter(Boolean)
  )];

  for (const phone of uniquePhones) {
    try {
      const msg = typeof buildMessage === 'function' ? buildMessage({ phone }) : buildMessage;
      await client.sendMessage(`${phone}@c.us`, msg);
      await new Promise(r => setTimeout(r, 1500)); // anti-spam
    } catch (err) {
      console.error(`[scheduler] Error enviando a ${phone}:`, err.message);
    }
  }
}

export function startScheduler(client) {

  // Reset diario — medianoche hora Paraguay
  cron.schedule('0 0 * * *', async () => {
    console.log('[scheduler] Enviando reset diario...');
    await sendToAll(client,
      `⚔️ *¡Un nuevo día en el Reino!*\n\n🎮 Tus límites de juego se han reiniciado.\n🪙 ¡A ganar oro, guerrero!`
    );
  }, TZ);

  // Ranking semanal — lunes 9am hora Paraguay
  cron.schedule('0 9 * * 1', async () => {
    console.log('[scheduler] Enviando ranking semanal...');

    const { data: top } = await supabase
      .from('players')
      .select('phone, username, weekly_gold')
      .order('weekly_gold', { ascending: false })
      .limit(3);

    // ✅ Guard: puede haber menos de 3 jugadores
    if (!top?.length) return;

    const podio = ['🥇', '🥈', '🥉'];
    const lines = top
      .map((p, i) => `${podio[i]} *${p.username}* — ${p.weekly_gold.toLocaleString()} oro`)
      .join('\n');

    const msg = `👑 *RANKING SEMANAL FINAL*\n\n${lines}\n\n_¡El reino honra a sus campeones!_ ⚔️`;

    await sendToAll(client, msg);

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
