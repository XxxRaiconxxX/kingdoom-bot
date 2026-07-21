import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'whatsapp-web.js';
import { heraldCard, heraldList, heraldSection } from '../formatting.js';
import { getLatestApkUrl } from '../services/apkService.js';
const { MessageMedia } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RELEASES_DIR = path.resolve(__dirname, '../../releases');
const APK_FILE_PATTERN = /^Kingdoom_(\d+(?:\.\d+){1,3})\.apk$/i;
const APK_CAPTION = heraldCard('Aplicacion oficial de Kingdoom', [
  '> _Crea y administra tu ficha desde el telefono._',
  'Instala el archivo adjunto para vivir la experiencia completa.',
  '⚠️ Si Android solicita permiso para instalar desde fuentes desconocidas, habilitalo solo para completar esta instalacion.',
], { icon: '📲' });

export async function sendLatestApk(target, options = {}) {
  const apkUrl = await getLatestApkUrl();
  
  try {
    const response = await fetch(apkUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64data = buffer.toString('base64');
    
    const media = new MessageMedia(
      'application/vnd.android.package-archive',
      base64data,
      'Kingdoom-Fichas.apk'
    );
    
    const sendOptions = {
      caption: options.caption ?? APK_CAPTION,
    };

    await target.sendMessage(media, sendOptions);
    return apkUrl;
  } catch (err) {
    console.error(`[sendLatestApk] Error fetching or sending: ${err.message}`);
    throw err;
  }
}

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
  console.log(`[welcome] group_join detected enabled=${config.enabled} filterConfigured=${Boolean(config.groupId || config.groupName)}`);

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

  const firstMessage = `⚔️ ══════════════════════════════ ⚔️
🏰       REINO DE LAS SOMBRAS       🏰
              — KINGDOOM —
⚔️ ══════════════════════════════ ⚔️

📜 Que conste en los archivos del reino...

El/La aventurero/a conocido/a como
        ✦ ${welcomeMentions} ✦
ha cruzado oficialmente las puertas
de la Taberna y es declarado/a
ciudadano/a del Reino de las Sombras.

⚔️ ══════════════════════════════ ⚔️
🍺  LA TABERNA — Tu hogar en el reino
⚔️ ══════════════════════════════ ⚔️

La Taberna es el corazón del reino.
Aquí los aventureros se reúnen, apostan
su oro, sellan tratos y forjan su leyenda.

🎲 MINIJUEGOS DE LA TABERNA:
▸ 💥 TavernCrash — Apuesta antes del crash
▸ 🃏 TavernCards — Duelos de cartas
▸ 🎰 TavernSlots — Las ranuras del destino
▸ 🪄 Torre del Mago — Desafía la suerte
▸ 🎟️ Rasca y Gana — Tu fortuna está oculta

⚔️ ══════════════════════════════ ⚔️
🪙        EL MERCADO P2P
⚔️ ══════════════════════════════ ⚔️

Compra, vende e intercambia con otros
aventureros del reino en tiempo real.
Cada trato sellado es parte de tu historia.

▸ 🛒 Publica tus objetos
▸ 💰 Negocia tu precio
▸ 🤝 Cierra el trato

⚔️ ══════════════════════════════ ⚔️
🗺️     MISIONES Y EVENTOS
⚔️ ══════════════════════════════ ⚔️

El reino nunca duerme.
Cada semana trae nuevos desafíos,
clasificaciones y recompensas épicas.

▸ 🏆 Rankings semanales de oro
▸ ⚔️ Eventos especiales del reino
▸ 🎁 Recompensas y drops exclusivos
▸ 📯 Avisos importantes en tiempo real

⚔️ ══════════════════════════════ ⚔️
📜       LAS REGLAS DEL REINO
⚔️ ══════════════════════════════ ⚔️

Todo aventurero debe respetar el código:

▸ 🤝 Respeto entre ciudadanos
▸ 🚫 Nada de spam ni promociones ajenas
▸ ⚖️ Los tratos se honran
▸ 🔇 Los conflictos se resuelven en privado
▸ 👑 La palabra de los Custodios es ley

El incumplimiento puede resultar en
destierro permanente del reino.

⚔️ ══════════════════════════════ ⚔️
🔗       TU PRIMER PASO
⚔️ ══════════════════════════════ ⚔️

Antes de empezar tu aventura,
consulta el canal oficial y nuestra web:

📌 Canal oficial del reino:
👉 https://whatsapp.com/channel/0029Vb85e337YSdBx5Swjg0R

📖 Biblioteca y Guia Web:
👉 https://kingdoom-library.vercel.app/
_¡Entra para leer el lore y usar la guia de inicio oficial!_

Ahí encontrarás todo lo que necesitas
para comenzar tu camino en las sombras.

⚔️ ══════════════════════════════ ⚔️

     🏰 Bienvenido/a al reino,
          aventurero/a. 🏰

  Que el oro fluya y las sombras
       te sean favorables. 🗡️

— Los Custodios del Reino de las Sombras —

⚔️ ══════════════════════════════ ⚔️`;

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
      mentions: joinedContacts.map((c) => c.id._serialized),
    });
    
    // Tiny delay of 1.5 seconds so both messages are received in order
    await new Promise((r) => setTimeout(r, 1500));
    
    await chat.sendMessage(secondMessage);

    await new Promise((r) => setTimeout(r, 1500));
    try {
      await sendLatestApk(chat);
    } catch (e) {
      console.error('Error enviando APK de bienvenida:', e.message);
    }
  } catch (error) {
    console.error('[welcome] failed to send welcome messages:', error.message);
  }
}
