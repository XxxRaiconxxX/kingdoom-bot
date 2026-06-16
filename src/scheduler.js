import cron from 'node-cron';
import { supabase, processMarketInstallments } from './supabase.js';
import { normalizePhone } from './adminStore.js';
import { getActiveProfile } from './activeProfileStore.js';
import { hydrateOpenTreasures, scheduleDailyTreasures } from './handlers/treasure.js';

const TZ = { timezone: 'America/Asuncion' };
const schedulerState = {
  expiredAuctionsRunning: false,
  dailyResetRunning: false,
  weeklyResetRunning: false,
};

async function runScheduledJob(key, label, task) {
  if (schedulerState[key]) {
    console.warn(`[scheduler] ${label} omitido: la ejecucion anterior sigue en curso.`);
    return;
  }

  schedulerState[key] = true;
  try {
    await task();
  } finally {
    schedulerState[key] = false;
  }
}

async function sendToAll(client, buildMessage) {
  const { data: players, error } = await supabase
    .from('players')
    .select('id, username, phone')
    .not('phone', 'is', null);

  if (error || !players?.length) return;

  const phoneMap = new Map();
  players.forEach((player) => {
    if (player.phone) {
      player.phone.split(',').forEach((p) => {
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
      const activePlayer = linkedPlayers.find((p) => p.id === activeId) || linkedPlayers[0];

      const msg =
        typeof buildMessage === 'function'
          ? buildMessage({ phone, username: activePlayer.username })
          : buildMessage;

      if (!client || !client.info) {
        console.log(`[scheduler] Cliente no inicializado o en estado zombie. Omitiendo mensaje a ${phone}`);
        continue;
      }

      await client.sendMessage(`${phone}@c.us`, msg);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    } catch (err) {
      console.error(`[scheduler] Error enviando a ${phone}:`, err.message);
    }
  }
}

export function startScheduler(client) {
  void hydrateOpenTreasures(client);
  scheduleDailyTreasures(client);

  cron.schedule(
    '*/1 * * * *',
    async () => {
      await runScheduledJob('expiredAuctionsRunning', 'ciclo de subastas expiradas', async () => {
        try {
          const { data: expiredAuctions, error } = await supabase
            .from('market_auctions')
            .select('id, item_name')
            .eq('status', 'active')
            .lte('expires_at', new Date().toISOString())
            .limit(10);

          if (error) {
            console.error('[scheduler] Error buscando subastas expiradas:', error.message);
            return;
          }

          if (expiredAuctions && expiredAuctions.length > 0) {
            for (const auction of expiredAuctions) {
              console.log(`[scheduler] Resolviendo subasta expirada: ${auction.item_name} (${auction.id})`);
              const { error: resolveError } = await supabase.rpc('resolve_market_auction', {
                p_auction_id: auction.id,
              });

              if (resolveError) {
                console.error(`[scheduler] Error al resolver subasta ${auction.id}:`, resolveError.message);
              } else {
                console.log(`[scheduler] Subasta ${auction.id} resuelta exitosamente.`);
              }
            }
          }
        } catch (err) {
          console.error('[scheduler] Error en el ciclo de subastas:', err);
        }
      });
    },
    TZ
  );

  cron.schedule(
    '0 0 * * *',
    async () => {
      await runScheduledJob('dailyResetRunning', 'reset diario', async () => {
        console.log('[scheduler] Iniciando reset diario y cobro de cuotas...');

        try {
          const results = await processMarketInstallments();
          console.log('[scheduler] Cuotas de mercado procesadas:', results);
        } catch (err) {
          console.error('[scheduler] Error procesando cuotas de mercado:', err);
        }

        void hydrateOpenTreasures(client);
        scheduleDailyTreasures(client);
        await sendToAll(
          client,
          ({ username }) =>
            `La noche cae sobre el Reino de las Sombras...\n\nSaludos, valiente *${username}*. Tus limites de juego se han reiniciado con el amanecer.\nLevantate, empuna tu arma y forja tu propio destino hoy. A ganar oro, guerrero.`
        );
      });
    },
    TZ
  );

  cron.schedule(
    '0 9 * * 1',
    async () => {
      await runScheduledJob('weeklyResetRunning', 'reset semanal', async () => {
        console.log('[scheduler] Enviando mensaje motivacional semanal...');

        await sendToAll(
          client,
          ({ username }) =>
            `Un nuevo ciclo comienza en el reino.\n\nEl Rey Supremo te observa, *${username}*. Las bestias son feroces, los caminos oscuros, pero tu leyenda apenas comienza a escribirse.\n\nQue los dioses de Kingdoom guien tus pasos esta semana.`
        );

        await supabase
          .from('players')
          .update({ weekly_gold: 0 })
          .gte('weekly_gold', 0);

        console.log('[scheduler] weekly_gold reseteado.');
      });
    },
    TZ
  );

  console.log('[scheduler] iniciado (timezone: America/Asuncion)');
}
