import cron from 'node-cron';
import {
  supabase,
  botStateSupabase,
  processMarketInstallments,
  archiveExpiredGraceProfiles,
  processRoleplayAccessEnforcement,
  getRoleplayLockWindowDays,
  reconcilePendingGameRewards,
  reconcilePendingTreasureCredits,
} from './supabase.js';
import { normalizePhone } from './adminStore.js';
import { getActiveProfile } from './activeProfileStore.js';
import { hydrateOpenTreasures, scheduleDailyTreasures } from './handlers/treasure.js';
import { resolveWhatsAppRecipientId } from './whatsappIdentity.js';
import {
  decideTrackedDelivery,
  getWhatsAppMessageId,
  inspectMessageServerAck,
  isNotificationDeliveryClaimAvailable,
  isPermanentWhatsappRecipientError,
  isTransientWhatsappDeliveryError,
  NOTIFICATION_CONTEXT_RETRY_DELAY_MS,
  sendMessageWithResult,
  waitForMessageServerAck,
} from './whatsappDelivery.js';

const TZ = { timezone: 'America/Asuncion' };
const NOTIFICATION_QUEUE_FETCH_LIMIT = Number(process.env.WHATSAPP_QUEUE_FETCH_LIMIT ?? 5);
const NOTIFICATION_MAX_SUCCESS_PER_RUN = Math.max(1, Number(process.env.WHATSAPP_QUEUE_MAX_SUCCESS_PER_RUN ?? 1));
const NOTIFICATION_MIN_INTERVAL_MS = Math.max(30_000, Number(process.env.WHATSAPP_QUEUE_MIN_INTERVAL_MS ?? 90_000));
const NOTIFICATION_MAX_INTERVAL_MS = Math.max(NOTIFICATION_MIN_INTERVAL_MS, Number(process.env.WHATSAPP_QUEUE_MAX_INTERVAL_MS ?? 180_000));
const NOTIFICATION_HOURLY_LIMIT = Math.max(1, Number(process.env.WHATSAPP_QUEUE_HOURLY_LIMIT ?? 20));
const NOTIFICATION_HOURLY_COOLDOWN_MS = Math.max(5 * 60 * 1000, Number(process.env.WHATSAPP_QUEUE_HOURLY_COOLDOWN_MS ?? 30 * 60 * 1000));
const BULK_NOTIFICATION_HOURLY_LIMIT = Math.max(1, Number(process.env.WHATSAPP_QUEUE_BULK_HOURLY_LIMIT ?? 6));
const BULK_NOTIFICATION_MIN_INTERVAL_MS = Math.max(NOTIFICATION_MIN_INTERVAL_MS, Number(process.env.WHATSAPP_QUEUE_BULK_MIN_INTERVAL_MS ?? 4 * 60 * 1000));
const BULK_NOTIFICATION_MAX_INTERVAL_MS = Math.max(BULK_NOTIFICATION_MIN_INTERVAL_MS, Number(process.env.WHATSAPP_QUEUE_BULK_MAX_INTERVAL_MS ?? 8 * 60 * 1000));
const schedulerState = {
  expiredAuctionsRunning: false,
  dailyResetRunning: false,
  weeklyResetRunning: false,
  notificationQueueRunning: false,
  playerLifecycleArchiveRunning: false,
  roleplayAccessRunning: false,
};
let notificationDispatchPausedUntil = 0;
let nextNotificationDispatchAt = 0;
const notificationRateWindow = {
  startedAt: 0,
  sentCount: 0,
  bulkSentCount: 0,
};
const inMemoryNotificationDeliveries = new Map();
let notificationDeliveryColumnsSupported = true;

function isMissingNotificationDeliveryColumn(error) {
  return ['42703', 'PGRST204'].includes(String(error?.code ?? ''))
    || /delivery_(?:message_id|started_at|attempts|error)/i.test(String(error?.message ?? ''));
}

async function fetchPendingNotifications() {
  const columns = notificationDeliveryColumnsSupported
    ? 'id, player_phone, message, delivery_message_id, delivery_started_at, delivery_attempts, delivery_error'
    : 'id, player_phone, message';
  let result = await botStateSupabase
    .from('bot_notifications_queue')
    .select(columns)
    .eq('sent', false)
    .order('created_at', { ascending: true })
    .limit(NOTIFICATION_QUEUE_FETCH_LIMIT);

  if (result.error && notificationDeliveryColumnsSupported && isMissingNotificationDeliveryColumn(result.error)) {
    notificationDeliveryColumnsSupported = false;
    console.warn('[scheduler] Migracion de trazabilidad de entregas pendiente; se usara reconciliacion en memoria.');
    result = await botStateSupabase
      .from('bot_notifications_queue')
      .select('id, player_phone, message')
      .eq('sent', false)
      .order('created_at', { ascending: true })
      .limit(NOTIFICATION_QUEUE_FETCH_LIMIT);
  }

  return result;
}

async function updateNotificationState(itemId, values) {
  const safeValues = notificationDeliveryColumnsSupported
    ? values
    : Object.fromEntries(
        Object.entries(values).filter(([key]) => !key.startsWith('delivery_'))
      );
  return botStateSupabase.from('bot_notifications_queue').update(safeValues).eq('id', itemId);
}

export async function claimPendingNotificationDelivery(item, now = Date.now()) {
  if (!notificationDeliveryColumnsSupported) return true;
  if (!isNotificationDeliveryClaimAvailable(item, now)) return false;

  const previousStartedAt = String(item?.delivery_started_at ?? '').trim();
  let query = botStateSupabase
    .from('bot_notifications_queue')
    .update({
      delivery_started_at: new Date(now).toISOString(),
      delivery_error: 'DELIVERY_CLAIMED',
    })
    .eq('id', item.id)
    .eq('sent', false)
    .is('delivery_message_id', null);
  query = previousStartedAt
    ? query.eq('delivery_started_at', previousStartedAt)
    : query.is('delivery_started_at', null);

  const { data, error } = await query.select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

export async function prepareTrackedNotificationRetry(item, inspectionState) {
  if (!notificationDeliveryColumnsSupported) return { prepared: true, error: null };
  const messageId = getWhatsAppMessageId(item?.delivery_message_id);
  if (!messageId) return { prepared: false, error: null };

  const { data, error } = await botStateSupabase
    .from('bot_notifications_queue')
    .update({
      delivery_message_id: null,
      delivery_started_at: null,
      delivery_error: `retry_after_${inspectionState}`,
    })
    .eq('id', item.id)
    .eq('sent', false)
    .eq('delivery_message_id', messageId)
    .select('id');
  return { prepared: Array.isArray(data) && data.length === 1, error };
}

function isWhatsappClientReady(client, isClientReady) {
  try {
    return Boolean(
      isClientReady() &&
      client?.info &&
      client.pupPage &&
      !client.pupPage.isClosed()
    );
  } catch {
    return false;
  }
}

function randomBetween(min, max) {
  if (max <= min) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function resetNotificationWindowIfNeeded(now) {
  if (!notificationRateWindow.startedAt || now - notificationRateWindow.startedAt >= 60 * 60 * 1000) {
    notificationRateWindow.startedAt = now;
    notificationRateWindow.sentCount = 0;
    notificationRateWindow.bulkSentCount = 0;
  }
}

function classifyNotificationMessage(message) {
  const text = String(message ?? '').toLowerCase();

  if (
    text.includes('acceso restringido por inactividad de rol') ||
    text.includes('acceso restaurado por inactividad de rol') ||
    text.includes('desbloquear minijuegos') ||
    text.includes('gracia activa')
  ) {
    return 'critical';
  }

  if (
    text.includes('un nuevo ciclo comienza en el reino') ||
    text.includes('el rey supremo te observa') ||
    text.includes('esta semana')
  ) {
    return 'bulk';
  }

  return 'standard';
}

function pickNotificationIntervalMs(priority) {
  if (priority === 'bulk') {
    return randomBetween(
      BULK_NOTIFICATION_MIN_INTERVAL_MS,
      BULK_NOTIFICATION_MAX_INTERVAL_MS
    );
  }

  return randomBetween(NOTIFICATION_MIN_INTERVAL_MS, NOTIFICATION_MAX_INTERVAL_MS);
}

function canDispatchNotification(now, priority) {
  resetNotificationWindowIfNeeded(now);

  if (now < notificationDispatchPausedUntil || now < nextNotificationDispatchAt) {
    return false;
  }

  if (notificationRateWindow.sentCount >= NOTIFICATION_HOURLY_LIMIT) {
    notificationDispatchPausedUntil = Math.max(
      notificationDispatchPausedUntil,
      now + NOTIFICATION_HOURLY_COOLDOWN_MS
    );
    console.warn(
      `[scheduler] Cola privada en enfriamiento: se alcanzo el tope de ${NOTIFICATION_HOURLY_LIMIT} mensajes por hora.`
    );
    return false;
  }

  if (priority === 'bulk' && notificationRateWindow.bulkSentCount >= BULK_NOTIFICATION_HOURLY_LIMIT) {
    notificationDispatchPausedUntil = Math.max(
      notificationDispatchPausedUntil,
      now + NOTIFICATION_HOURLY_COOLDOWN_MS
    );
    console.warn(
      `[scheduler] Cola bulk en enfriamiento: se alcanzo el tope de ${BULK_NOTIFICATION_HOURLY_LIMIT} mensajes promocionales por hora.`
    );
    return false;
  }

  return true;
}

function noteNotificationDelivered(now, priority) {
  resetNotificationWindowIfNeeded(now);
  notificationRateWindow.sentCount += 1;
  if (priority === 'bulk') {
    notificationRateWindow.bulkSentCount += 1;
  }
  nextNotificationDispatchAt = now + pickNotificationIntervalMs(priority);
}

function prioritizePendingNotifications(pending) {
  const rank = {
    critical: 0,
    standard: 1,
    bulk: 2,
  };

  return [...(pending ?? [])].sort((left, right) => {
    const leftPriority = classifyNotificationMessage(left?.message);
    const rightPriority = classifyNotificationMessage(right?.message);
    return rank[leftPriority] - rank[rightPriority];
  });
}

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
      console.error('[scheduler] Error construyendo una notificacion:', err.message);
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

export function startScheduler(client, isClientReady = () => Boolean(client?.info)) {
  void hydrateOpenTreasures(client, isClientReady);
  void reconcilePendingTreasureCredits().then((result) => {
    if (result.reconciled > 0) {
      console.log(`[scheduler] ${result.reconciled} credito(s) de tesoro reconciliado(s) al iniciar.`);
    }
  }).catch((error) => console.error('[scheduler] Error reconciliando tesoros al iniciar:', error.message));
  void reconcilePendingGameRewards().then((result) => {
    if (result.reconciled > 0) {
      console.log(`[scheduler] ${result.reconciled} premio(s) de juego reconciliado(s) al iniciar.`);
    }
  }).catch((error) => console.error('[scheduler] Error reconciliando premios al iniciar:', error.message));
  scheduleDailyTreasures(client, isClientReady);

  cron.schedule(
    '*/1 * * * *',
    async () => {
      await runScheduledJob('treasureCreditReconciliationRunning', 'creditos de tesoro pendientes', async () => {
        const result = await reconcilePendingTreasureCredits();
        if (result.reconciled > 0) {
          console.log(`[scheduler] ${result.reconciled} credito(s) de tesoro reconciliado(s).`);
        }
        const gameResult = await reconcilePendingGameRewards();
        if (gameResult.reconciled > 0) {
          console.log(`[scheduler] ${gameResult.reconciled} premio(s) de juego reconciliado(s).`);
        }
      });
    },
    TZ
  );

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
        if (Date.now() < notificationDispatchPausedUntil) return;
        if (!isWhatsappClientReady(client, isClientReady)) return;

        try {
          const { data: pending, error } = await fetchPendingNotifications();

          if (error) {
            console.error('[scheduler] Error leyendo cola:', error.message);
            return;
          }

          if (pending && pending.length > 0) {
            let deliveredThisRun = 0;

            for (const item of prioritizePendingNotifications(pending)) {
              const now = Date.now();
              const priority = classifyNotificationMessage(item.message);
              if (!isWhatsappClientReady(client, isClientReady)) {
                console.warn('[scheduler] Cola en pausa: WhatsApp ya no esta listo para despachar.');
                return;
              }

              const trackedItem = {
                ...item,
                ...(inMemoryNotificationDeliveries.get(item.id) ?? {}),
              };
              let deliveryItem = trackedItem;
              if (getWhatsAppMessageId(trackedItem.delivery_message_id)) {
                const inspection = await inspectMessageServerAck(
                  client,
                  trackedItem.delivery_message_id
                );
                const decision = decideTrackedDelivery(trackedItem, inspection, now);

                if (decision === 'mark_sent') {
                  const { error: reconciledError } = await updateNotificationState(item.id, {
                    sent: true,
                    sent_at: new Date().toISOString(),
                    delivery_error: null,
                  });
                  if (reconciledError) {
                    console.error('[scheduler] Error reconciliando entrega confirmada:', reconciledError.message);
                    return;
                  }
                  inMemoryNotificationDeliveries.delete(item.id);
                  continue;
                }

                if (decision === 'hold') {
                  continue;
                }

                const { prepared, error: resetError } = await prepareTrackedNotificationRetry(
                  trackedItem,
                  inspection.state
                );
                if (resetError) {
                  console.error('[scheduler] Error preparando reintento trazable:', resetError.message);
                  return;
                }
                if (!prepared) return;
                inMemoryNotificationDeliveries.delete(item.id);
                deliveryItem = {
                  ...trackedItem,
                  delivery_message_id: null,
                  delivery_started_at: null,
                  delivery_error: `retry_after_${inspection.state}`,
                };
              }

              if (!canDispatchNotification(now, priority)) {
                return;
              }

              const claimed = await claimPendingNotificationDelivery(deliveryItem, now);
              if (!claimed) return;

              try {
                const recipientId = await resolveWhatsAppRecipientId(client, item.player_phone);
                if (!recipientId) throw new Error('Number is not registered on WhatsApp');
                const { message, messageId } = await sendMessageWithResult(
                  client,
                  recipientId,
                  item.message
                );
                const deliveryStartedAt = new Date().toISOString();
                const deliveryState = {
                  delivery_message_id: messageId,
                  delivery_started_at: deliveryStartedAt,
                  delivery_attempts: Number(deliveryItem.delivery_attempts ?? 0) + 1,
                  delivery_error: null,
                };
                inMemoryNotificationDeliveries.set(item.id, deliveryState);

                const { error: trackingError } = await updateNotificationState(item.id, deliveryState);
                if (trackingError) {
                  throw new Error(`No se pudo guardar la trazabilidad del envio: ${trackingError.message}`);
                }

                await waitForMessageServerAck(client, message);
                const { error: sentStateError } = await updateNotificationState(item.id, {
                  sent: true,
                  sent_at: new Date().toISOString(),
                  delivery_error: null,
                });
                if (sentStateError) {
                  throw new Error(`No se pudo confirmar la entrega en la cola: ${sentStateError.message}`);
                }
                inMemoryNotificationDeliveries.delete(item.id);
                noteNotificationDelivered(now, priority);
                deliveredThisRun += 1;

                if (deliveredThisRun >= NOTIFICATION_MAX_SUCCESS_PER_RUN) {
                  // ponytail: el rate limit vive en memoria para no agregar migracion ahora; si algun dia hace falta continuidad tras reinicio, se persiste en Supabase.
                  return;
                }
              } catch (err) {
                console.error('[scheduler] Error despachando una notificacion:', err.message);
                if (notificationDeliveryColumnsSupported) {
                  await updateNotificationState(item.id, {
                    delivery_error: String(err?.code ?? err?.message ?? 'delivery_error').slice(0, 240),
                  });
                }
                if (isTransientWhatsappDeliveryError(err)) {
                  notificationDispatchPausedUntil = Date.now() + NOTIFICATION_CONTEXT_RETRY_DELAY_MS;
                  console.warn(
                    `[scheduler] WhatsApp cambio de contexto; la cola se reintentara en ${Math.round(NOTIFICATION_CONTEXT_RETRY_DELAY_MS / 60000)} minutos sin descartar el mensaje.`
                  );
                  return;
                }

                if (isPermanentWhatsappRecipientError(err)) {
                  // ponytail: sent=true evita bloquear para siempre la cola con un destinatario invalido.
                  await updateNotificationState(item.id, {
                    sent: true,
                    delivery_error: String(err?.message ?? err).slice(0, 240),
                  });
                  inMemoryNotificationDeliveries.delete(item.id);
                  continue;
                }

                notificationDispatchPausedUntil = Date.now() + NOTIFICATION_CONTEXT_RETRY_DELAY_MS;
                console.warn('[scheduler] Error no clasificado; el mensaje queda pendiente para evitar una entrega falsa.');
                return;
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

        void hydrateOpenTreasures(client, isClientReady);
        scheduleDailyTreasures(client, isClientReady);
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

        const { error: resetError } = await supabase
          .from('players')
          .update({ weekly_gold: 0 })
          .gte('weekly_gold', 0);

        if (resetError) {
          throw new Error(`No se pudo resetear weekly_gold: ${resetError.message}`);
        }

        console.log('[scheduler] weekly_gold reseteado.');
      });
    },
    TZ
  );

  console.log('[scheduler] iniciado (timezone: America/Asuncion)');
}
