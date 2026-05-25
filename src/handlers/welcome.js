import { heraldCard, heraldList, heraldSection } from '../formatting.js';

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
  return raw.endsWith('@c.us') || raw.endsWith('@g.us') ? raw : `${raw}@c.us`;
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

export function buildWelcomeConfig() {
  return {
    enabled: process.env.WELCOME_GROUP_ENABLED !== 'false',
    groupId: String(process.env.WELCOME_GROUP_ID ?? '').trim(),
    groupName: normalizeText(process.env.WELCOME_GROUP_NAME ?? ''),
    adminIds: parseAdminIds(process.env.WELCOME_GROUP_ADMIN_IDS),
  };
}

export async function handleGroupWelcome(notification, client, config = buildWelcomeConfig()) {
  if (!config.enabled) return;

  const chat = await notification.getChat();
  const groupId = chat?.id?._serialized || notification.chatId || '';
  const groupName = normalizeText(chat?.name ?? '');
  console.log(`[welcome] group_join detected – group="${chat?.name}" id="${groupId}" enabled=${config.enabled} filter=${config.groupId || config.groupName || '(none)'}`);

  const hasFilter = !!(config.groupId || config.groupName);
  if (hasFilter) {
    const matchesGroupId = config.groupId && groupId === config.groupId;
    const matchesGroupName = config.groupName && groupName === config.groupName;
    if (!matchesGroupId && !matchesGroupName) return;
  }
  // If no filter is configured, welcome fires in every group

  const botId = client.info?.wid?._serialized || '';
  
  let rawContacts = [];
  try {
    rawContacts = await notification.getRecipients();
  } catch (err) {
    console.error('[welcome] Error fetching recipients:', err.message);
  }

  // Fallback if getRecipients() fails or returns empty but we have recipientIds
  if ((!rawContacts || rawContacts.length === 0) && notification.recipientIds && notification.recipientIds.length > 0) {
    rawContacts = await Promise.all(notification.recipientIds.map(async id => {
      try {
        const contact = await client.getContactById(id);
        return contact || { id: { _serialized: id }, number: id.split('@')[0] };
      } catch (e) {
        return { id: { _serialized: id }, number: id.split('@')[0] };
      }
    }));
  }

  const joinedContacts = uniqueById(rawContacts).filter(
    (contact) => contact?.id?._serialized && contact.id._serialized !== botId
  );

  if (!joinedContacts.length) {
    console.log('[welcome] No valid contacts found to welcome.');
    return;
  }

  const welcomeMentions = joinedContacts
    .map((contact) => {
      const fallbackName = contact.pushname || contact.name || contact.shortName;
      if (contact.number) return `@${contact.number}`;
      if (fallbackName) return fallbackName;
      return `@aventurero`;
    })
    .join(' ');

  const firstMessage = heraldCard('Bienvenida al Reino de las Sombras', [
    `Bienvenido, ${welcomeMentions}.`,
    'Has cruzado la puerta de la taberna oficial de Kingdoom.',
    heraldSection('Aqui podras'),
    heraldList([
      'Jugar en la Taberna',
      'Comerciar en el mercado P2P',
      'Competir en misiones y eventos',
      'Mantenerte al dia con avisos y novedades',
    ], '▸'),
    heraldSection('Primer enlace clave'),
    'Ficha, lore y primeros pasos:',
    'https://whatsapp.com/channel/0029Vb85e337YSdBx5Swjg0R',
  ], { icon: '🏰' });

  const secondMessage = heraldCard('Guardianes del reino', [
    heraldList([
      '*Nothing* — Senor de la Taberna',
      '*Zoelfrost* — Guardian del Tesoro',
      '*Ord* — Heraldo del Reino',
      '*E.xe* — El Cybord',
    ], '🗡️'),
    'Ante cualquier duda o conflicto, acude a uno de los Guardianes.',
  ], { icon: '👑' });

  try {
    await chat.sendMessage(firstMessage, {
      mentions: joinedContacts,
    });
    
    // Tiny delay of 1.5 seconds so both messages are received in order
    await new Promise((r) => setTimeout(r, 1500));
    
    await chat.sendMessage(secondMessage);
  } catch (error) {
    console.error('[welcome] failed to send welcome messages:', error.message);
  }
}
