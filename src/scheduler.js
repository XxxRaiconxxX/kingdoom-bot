import cron from 'node-cron';
import {
  supabase,
  botStateSupabase,
  processMarketInstallments,
  archiveExpiredGraceProfiles,
  processRoleplayAccessEnforcement,
  getRoleplayLockWindowDays,
} from './supabase.js';
import { normalizePhone, formatJid } from './adminStore.js';
import { getActiveProfile } from './activeProfileStore.js';
import { hydrateOpenTreasures, scheduleDailyTreasures } from './handlers/treasure.js';
import { runPeriodicAudit } from './audit.js';

const TZ = { timezone: 'America/Asuncion' };
const schedulerState = {
  expiredAuctionsRunning: false,
  dailyResetRunning: false,
  weeklyResetRunning: false,
  notificationQueueRunning: false,
  playerLifecycleArchiveRunning: false,
  roleplayAccessRunning: false,
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

  const queueInserts = [];
  for (const [phone, linkedPlayers] of phoneMap.entries()) {
    try {
      const activeId = getActiveProfile(phone);
      const activePlayer = linkedPlayers.find((p) => p.id === activeId) || linkedPlayers[0];

      const msg =
        typeof buildMessage === 'function'
          ? buildMessage({ phone, username: activePlayer.username })
          : buildMessage;

      queueInserts.push({
        player_phone: phone,
        message: msg,
      });
    } catch (err) {
      console.error(`[scheduler] Error construyendo mensaje para ${phone}:`, err.message);
    }
  }

  if (queueInserts.length > 0) {
    const { error: insertError } = await botStateSupabase
      .from('bot_notifications_queue')
      .insert(queueInserts);

    if (insertError) {
      console.error('[scheduler] Error encolando notificaciones:', insertError.message);
    } else {
      console.log(`[scheduler] ${queueInserts.length} mensajes encolados exitosamente.`);
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
    '*/1 * * * *',
    async () => {
      await runScheduledJob('notificationQueueRunning', 'procesador de notificaciones', async () => {
        if (!client || !client.info) return;

        try {
          const { data: pending, error } = await botStateSupabase
            .from('bot_notifications_queue')
            .select('id, player_phone, message')
            .eq('sent', false)
            .order('created_at', { ascending: true })
            .limit(5);

          if (error) {
            console.error('[scheduler] Error leyendo cola:', error.message);
            return;
          }

          if (pending && pending.length > 0) {
            for (const item of pending) {
              try {
                await client.sendMessage(formatJid(item.player_phone), item.message);
                await new Promise((resolve) => setTimeout(resolve, 1500));
                await botStateSupabase
                  .from('bot_notifications_queue')
                  .update({ sent: true, sent_at: new Date().toISOString() })
                  .eq('id', item.id);
              } catch (err) {
                console.error(`[scheduler] Error despachando a ${item.player_phone}:`, err.message);
                // Mark as sent anyway to avoid blocking the queue if it's an invalid number
                await botStateSupabase.from('bot_notifications_queue').update({ sent: true }).eq('id', item.id);
              }
            }
          }
        } catch (err) {
          console.error('[scheduler] Error general procesando cola:', err.message);
        }
      });
    },
    TZ
  );

  cron.schedule(
    '*/15 * * * *',
    async () => {
      await runScheduledJob('playerLifecycleArchiveRunning', 'archivado de perfiles salientes', async () => {
        try {
          const archivedPlayers = await archiveExpiredGraceProfiles({
            actor: 'bot:scheduler',
          });

          if (archivedPlayers.length > 0) {
            console.log(`[scheduler] ${archivedPlayers.length} perfil(es) pasaron a archived por gracia vencida.`);
          }
        } catch (err) {
          console.error('[scheduler] Error archivando perfiles salientes:', err.message);
        }
      });
    },
    TZ
  );

  cron.schedule(
    '*/10 * * * *',
    async () => {
      await runScheduledJob('roleplayAccessRunning', 'enforcement de roleplay', async () => {
        try {
          const result = await processRoleplayAccessEnforcement();
          const queueInserts = [];

          (result.newlyLocked ?? []).forEach((entry) => {
            const phone = normalizePhone(entry.phone ?? '');
            if (phone) {
              queueInserts.push({
                player_phone: phone,
                message: `⚠️ *Acceso restringido por inactividad de rol*\nNo roleaste en los ultimos *${getRoleplayLockWindowDays()} dias*.\nPara desbloquear minijuegos, economia y consultas recreativas, vuelve a rolear en el grupo principal del reino.`,
              });
            }
          });

          (result.newlyUnlocked ?? []).forEach((entry) => {
            const phone = normalizePhone(entry.phone ?? '');
            if (phone) {
              queueInserts.push({
                player_phone: phone,
                message: `✅ *Acceso restaurado por inactividad de rol*\nSe ha detectado tu actividad dentro del umbral permitido de *${getRoleplayLockWindowDays()} dias* (o gracia activa).\nLos minijuegos, la economia y las consultas recreativas quedaron habilitados otra vez.`,
              });
            }
          });

          if (queueInserts.length > 0) {
            const { error: insertError } = await botStateSupabase
              .from('bot_notifications_queue')
              .insert(queueInserts);

            if (insertError) {
              console.error('[scheduler] Error encolando avisos de roleplay:', insertError.message);
            } else {
              console.log(`[scheduler] ${queueInserts.length} aviso(s) de estado de roleplay encolados.`);
            }
          }
        } catch (err) {
          console.error('[scheduler] Error evaluando acceso por roleplay:', err.message);
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

  cron.schedule(
    '0 4 * * *',
    async () => {
      await runScheduledJob('auditRunning', 'auditoria de seguridad', async () => {
        try {
          await runPeriodicAudit();
        } catch (err) {
          console.error('[scheduler] Error en la auditoria de seguridad:', err);
        }
      });
    },
    TZ
  );

  console.log('[scheduler] iniciado (timezone: America/Asuncion)');
}
