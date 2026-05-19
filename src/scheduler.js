import cron from 'node-cron';
import { supabase } from './supabase.js';

// ✅ Timezone Paraguay (UTC-4, con ajuste horario de verano)
const TZ = { timezone: 'America/Asuncion' };

async function sendToAll(client, buildMessage) {
  const { data: players, error } = await supabase
    .from('players')
    .select('phone')
    .not('phone', 'is', null);

  if (error || !players?.length) return;

  for (const p of players) {
    try {
      const msg = typeof buildMessage === 'function' ? buildMessage(p) : buildMessage;
      await client.sendMessage(`${p.phone}@c.us`, msg);
      await new Promise(r => setTimeout(r, 1500)); // anti-spam
    } catch (err) {
      console.error(`[scheduler] Error enviando a ${p.phone}:`, err.message);
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
    await supabase
      .from('players')
      .update({ weekly_gold: 0 });

    console.log('[scheduler] weekly_gold reseteado.');
  }, TZ);

  console.log('⏰ Scheduler iniciado (timezone: America/Asuncion)');
}
