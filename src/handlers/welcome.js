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
  const joinedContacts = uniqueById(await notification.getRecipients()).filter(
    (contact) => contact?.id?._serialized && contact.id._serialized !== botId
  );

  if (!joinedContacts.length) return;

  const welcomeMentions = joinedContacts
    .map((contact) => `@${contact.number}`)
    .join(' ');

  const firstMessage = 
    `┌──────────────────────────┐\n` +
    `│  ⚔️  REINO DE LAS SOMBRAS  ⚔️  │\n` +
    `│    𝐊 𝐈 𝐍 𝐆 𝐃 𝐎 𝐎 𝐌     │\n` +
    `└──────────────────────────┘\n\n` +
    `🏰 *Bienvenido, aventurero ${welcomeMentions}.*\n\n` +
    `Has cruzado las puertas de la taberna más oscura del reino. Aquí corren el oro, los dados y las leyendas.\n\n` +
    `🍺 Este es el espacio oficial de *Kingdoom*, donde nobles y bribones se reúnen para:\n\n` +
    `▸ 🎰 Jugar en la Taberna\n` +
    `▸ 💰 Comerciar en el mercado P2P\n` +
    `▸ 🏆 Competir en misiones y eventos\n` +
    `▸ 📜 Mantenerse al día con novedades\n\n` +
    `*¡Que el destino esté de tu lado!*\n\n` +
    `*La informacion para crear tu primer personaje estan aqui*\n\n` +
    `▸ https://whatsapp.com/channel/0029Vb85e337YSdBx5Swjg0R`;

  const secondMessage = 
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `👑 *GUARDIANES DEL REINO*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n\n` +
    `🗡️ *Nothing* — Señor de la Taberna\n` +
    `🗡️ *Zoelfrost* — Guardián del Tesoro\n` +
    `🗡️ *Ord* — Heraldo del Reino\n` +
    `🗡️ *E.xe* — El Cybord\n\n` +
    `📌 _Ante cualquier duda o conflicto, acude a uno de los Guardianes._`;

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
