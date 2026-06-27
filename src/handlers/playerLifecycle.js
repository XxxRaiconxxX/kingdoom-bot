import { normalizePhone } from '../adminStore.js';
import {
  getPlayerLifecycleGraceDays,
  markPhoneProfilesLeftGrace,
  reactivatePhoneProfilesFromGrace,
} from '../supabase.js';

const DEFAULT_GROUP_ID = '595971938097-1618930274@g.us';

function normalizeText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function normalizeWhatsappId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw.endsWith('@c.us') || raw.endsWith('@g.us') || raw.endsWith('@lid') ? raw : `${raw}@c.us`;
}

function parseAdminIds(value) {
  return String(value ?? '')
    .split(',')
    .map((entry) => normalizeWhatsappId(entry))
    .filter(Boolean);
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item?.id?._serialized || item?._serialized || item?.number || '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getNotificationRecipients(notification, client) {
  let rawContacts = [];
  try {
    rawContacts = await notification.getRecipients();
  } catch (err) {
    console.error('[playerLifecycle] Error fetching recipients:', err.message);
  }

  if ((!rawContacts || rawContacts.length === 0) && notification.recipientIds?.length > 0) {
    rawContacts = await Promise.all(notification.recipientIds.map(async (id) => {
      try {
        const contact = await client.getContactById(id);
        return contact || { id: { _serialized: id }, number: id.split('@')[0] };
      } catch {
        return { id: { _serialized: id }, number: id.split('@')[0] };
      }
    }));
  }

  const botId = client.info?.wid?._serialized || '';
  return uniqueById(rawContacts).filter(
    (contact) => contact?.id?._serialized && contact.id._serialized !== botId
  );
}

export function buildPlayerLifecycleConfig() {
  return {
    enabled: process.env.PLAYER_LIFECYCLE_ENABLED !== 'false',
    groupId: String(process.env.PLAYER_LIFECYCLE_GROUP_ID ?? DEFAULT_GROUP_ID).trim(),
    groupName: normalizeText(process.env.PLAYER_LIFECYCLE_GROUP_NAME ?? ''),
    adminIds: parseAdminIds(process.env.PLAYER_LIFECYCLE_ADMIN_IDS),
  };
}

function matchesLifecycleGroup(chat, notification, config) {
  const groupId = chat?.id?._serialized || notification.chatId || '';
  const groupName = normalizeText(chat?.name ?? '');

  const hasFilter = !!(config.groupId || config.groupName);
  if (!hasFilter) {
    return true;
  }

  return (
    (config.groupId && groupId === config.groupId) ||
    (config.groupName && groupName === config.groupName)
  );
}

function buildLeaveSummaryLine(phone, lifecycleResult) {
  const mention = `@${phone}`;
  const profileNames = lifecycleResult.players.map((player) => `*${player.username}*`);
  const graceDays = lifecycleResult.graceDays || getPlayerLifecycleGraceDays();

  if (!lifecycleResult.players.length) {
    return `${mention} salio del grupo principal. No se encontro un perfil vinculado para activar la gracia automatica.`;
  }

  const profileLabel = profileNames.length === 1
    ? `Perfil detectado: ${profileNames[0]}.`
    : `Perfiles detectados: ${profileNames.join(', ')}.`;

  return `${mention} salio del grupo principal. ${profileLabel} Entra en gracia de ${graceDays} dias antes de archivarse.`;
}

function buildRejoinSummaryLine(phone, lifecycleResult) {
  const mention = `@${phone}`;
  const profileNames = lifecycleResult.players.map((player) => `*${player.username}*`);

  if (!lifecycleResult.players.length) {
    return '';
  }

  const profileLabel = profileNames.length === 1
    ? `Perfil restaurado: ${profileNames[0]}.`
    : `Perfiles restaurados: ${profileNames.join(', ')}.`;

  return `${mention} regreso al grupo principal. ${profileLabel} Su estado vuelve a activo.`;
}

export async function handleGroupLeave(notification, client, config = buildPlayerLifecycleConfig()) {
  if (!config.enabled) return;

  const chat = await notification.getChat();
  if (!matchesLifecycleGroup(chat, notification, config)) {
    return;
  }

  const recipients = await getNotificationRecipients(notification, client);
  if (!recipients.length) {
    console.log('[playerLifecycle] group_leave without resolved recipients.');
    return;
  }

  const mentions = [];
  const lines = [];

  for (const contact of recipients) {
    const rawId = contact?.id?._serialized || '';
    const phone = normalizePhone(rawId || contact?.number || '');
    if (!phone) continue;

    mentions.push(contact);

    try {
      const lifecycleResult = await markPhoneProfilesLeftGrace(phone, {
        groupJid: chat?.id?._serialized || notification.chatId || '',
        actor: 'bot:group_leave',
      });
      lines.push(buildLeaveSummaryLine(phone, lifecycleResult));
    } catch (error) {
      console.error(`[group_leave] ${phone}:`, error.message);
      lines.push(`@${phone} salio del grupo principal, pero no se pudo registrar su estado de gracia. Motivo tecnico: ${error.message}`);
    }
  }

  if (!lines.length) {
    return;
  }

  await chat.sendMessage(
    `⚰️ *Salida del Reino*\n\n${lines.join('\n\n')}`,
    { mentions }
  );
}

export async function handleGroupRejoin(notification, client, config = buildPlayerLifecycleConfig()) {
  if (!config.enabled) return;

  const chat = await notification.getChat();
  if (!matchesLifecycleGroup(chat, notification, config)) {
    return;
  }

  const recipients = await getNotificationRecipients(notification, client);
  if (!recipients.length) {
    return;
  }

  const mentions = [];
  const lines = [];

  for (const contact of recipients) {
    const rawId = contact?.id?._serialized || '';
    const phone = normalizePhone(rawId || contact?.number || '');
    if (!phone) continue;

    try {
      const lifecycleResult = await reactivatePhoneProfilesFromGrace(phone, {
        groupJid: chat?.id?._serialized || notification.chatId || '',
        actor: 'bot:group_join',
      });

      if (lifecycleResult.updatedCount > 0) {
        mentions.push(contact);
        const line = buildRejoinSummaryLine(phone, lifecycleResult);
        if (line) {
          lines.push(line);
        }
      }
    } catch (error) {
      console.error(`[group_join reactivate] ${phone}:`, error.message);
    }
  }

  if (!lines.length) {
    return;
  }

  await chat.sendMessage(
    `🛡️ *Retorno al Reino*\n\n${lines.join('\n\n')}`,
    { mentions }
  );
}
