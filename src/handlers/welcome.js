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

function formatMultilineEnv(value) {
  return String(value ?? '')
    .replace(/\\n/g, '\n')
    .trim();
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
    intro:
      formatMultilineEnv(process.env.WELCOME_GROUP_INTRO) ||
      'Bienvenido al Reino de Kingdoom. Lee con atencion las instrucciones iniciales y presentate ante el consejo.',
    links:
      formatMultilineEnv(process.env.WELCOME_GROUP_LINKS) ||
      '• Web del reino: https://xxxraiconxxx.github.io/Kingdoom/\n• Ficha y reglamento: agrega aqui tus enlaces\n• Grupo de rol: agrega aqui el enlace correcto',
    adminIds: parseAdminIds(process.env.WELCOME_GROUP_ADMIN_IDS),
  };
}

export async function handleGroupWelcome(notification, client, config = buildWelcomeConfig()) {
  if (!config.enabled) return;

  const chat = await notification.getChat();
  const groupId = chat?.id?._serialized || notification.chatId || '';
  const groupName = normalizeText(chat?.name ?? '');

  const matchesGroupId = config.groupId && groupId === config.groupId;
  const matchesGroupName = config.groupName && groupName === config.groupName;

  if (!matchesGroupId && !matchesGroupName) return;

  const botId = client.info?.wid?._serialized || '';
  const joinedContacts = uniqueById(await notification.getRecipients()).filter(
    (contact) => contact?.id?._serialized && contact.id._serialized !== botId
  );

  if (!joinedContacts.length) return;

  const adminContacts = uniqueById(
    await Promise.all(
      config.adminIds.map(async (entry) => {
        try {
          return await client.getContactById(entry);
        } catch (error) {
          console.error('[welcome] admin mention failed:', entry, error.message);
          return null;
        }
      })
    )
  ).filter(Boolean);

  const welcomeMentions = joinedContacts
    .map((contact) => `@${contact.number}`)
    .join(' ');

  const adminMentions = adminContacts.length
    ? `\n\nPresentate con: ${adminContacts.map((contact) => `@${contact.number}`).join(' ')}`
    : '';

  const message =
    `🏰 *BIENVENIDO AL REINO*\n\n` +
    `${welcomeMentions}\n\n` +
    `${config.intro}\n\n` +
    `📜 *Primeros pasos*\n${config.links}` +
    `${adminMentions}`;

  await chat.sendMessage(message, {
    mentions: [...joinedContacts, ...adminContacts],
  });
}
