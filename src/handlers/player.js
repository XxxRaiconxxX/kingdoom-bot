import {
  getActiveEvents,
  getActiveMissions,
  getGoldLeaderboard,
  getLeaderboard,
  getMarketItemDetails,
  getPlayer,
  getRealmSnapshot,
  searchMarketItems,
} from '../supabase.js';
import { askKingdoomAI } from '../ai.js';

const SYSTEM_PROMPT = `Eres el Heraldo del Reino de Kingdoom - Reino de las Sombras.
Hablas con tono medieval, misterioso y epico. Usas emojis de espadas, coronas y fuego.
Eres conciso en WhatsApp (maximo 4 lineas). Nunca rompas el personaje.
Fecha actual: ${new Date().toLocaleDateString('es-PY')}`;

const chatHistory = new Map();

setInterval(() => {
  chatHistory.clear();
  console.log('[player] chatHistory limpiado');
}, 1000 * 60 * 60 * 6);

function clipText(value, max = 140) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1).trimEnd()}…`;
}

function formatStatus(value) {
  return String(value ?? '')
    .replace(/-/g, ' ')
    .toUpperCase();
}

function formatMarketItem(item) {
  const rarity = item.rarity ? ` - ${String(item.rarity).toUpperCase()}` : '';
  const price = Number(item.price ?? 0).toLocaleString('es-PY');
  return `• *${item.name}*${rarity} - 🪙 ${price} oro`;
}

function formatStock(item) {
  const status = formatStatus(item.stock_status ?? item.stockStatus ?? 'available');
  const limit = item.stock_limit ?? item.stockLimit ?? 0;
  const sold = item.stock_sold ?? item.stockSold ?? 0;

  if (limit > 0) {
    const remaining = Math.max(0, limit - sold);
    return `${status} (${remaining}/${limit})`;
  }

  return status;
}

function formatMissionRow(mission) {
  return `• *${mission.title}* - ${String(mission.difficulty).toUpperCase()} - 🪙 ${Number(mission.reward_gold ?? 0).toLocaleString('es-PY')}`;
}

function formatEventRow(event) {
  return `• *${event.title}* - ${formatStatus(event.status)} - 🎁 ${Number(event.participation_reward_gold ?? 0).toLocaleString('es-PY')} oro`;
}

export async function handlePlayerMessage(msg) {
  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);

  if (!player) {
    return `⚔️ *Viajero desconocido*, no estas registrado en el reino.\n\nEscribe *!registrar TuNombre* para unirte a Kingdoom.`;
  }

  const rawText = msg.body.trim();
  const text = rawText.toLowerCase();

  if (text === '!oro' || text === '!gold') {
    return `👑 *${player.username}*, tu fortuna actual:\n\n🪙 *${player.gold.toLocaleString('es-PY')} oro*\n\n_"El oro es el aliento del reino..."_`;
  }

  if (text === '!perfil' || text === '!estado') {
    return `🛡️ *PERFIL DEL AVENTURERO*\n\n👤 *${player.username}*\n🪙 Oro total: *${player.gold.toLocaleString('es-PY')}*\n🏆 Oro semanal: *${(player.weekly_gold ?? 0).toLocaleString('es-PY')}*`;
  }

  if (text === '!ranking' || text === '!top') {
    const board = await getLeaderboard();
    if (!board.length) return `📊 Aun no hay guerreros en el ranking.`;

    const lines = board.map((entry, index) => {
      const medal = ['🥇', '🥈', '🥉'][index] || `${index + 1}.`;
      return `${medal} *${entry.username}* - ${entry.weekly_gold.toLocaleString('es-PY')} oro`;
    }).join('\n');

    return `⚔️ *RANKING SEMANAL DEL REINO* ⚔️\n\n${lines}`;
  }

  if (text === '!ricos' || text === '!fortunas') {
    const board = await getGoldLeaderboard();
    if (!board.length) return `👑 Nadie ha amasado fortuna todavia.`;

    const lines = board.map((entry, index) => {
      const medal = ['🥇', '🥈', '🥉'][index] || `${index + 1}.`;
      return `${medal} *${entry.username}* - ${entry.gold.toLocaleString('es-PY')} oro`;
    }).join('\n');

    return `👑 *GRANDES FORTUNAS DEL REINO*\n\n${lines}`;
  }

  if (text.startsWith('!mercado')) {
    const query = rawText.replace(/^!mercado\s*/i, '').trim();
    const items = await searchMarketItems(query);

    if (!items.length) {
      return query
        ? `🏪 No halle articulos para *${query}* en el mercado del reino.`
        : `🏪 El mercado esta vacio hoy, viajero.`;
    }

    const maxItems = query ? 8 : 12;
    const lines = items.slice(0, maxItems).map(formatMarketItem).join('\n');

    return query
      ? `🔎 *MERCADO: ${query.toUpperCase()}*\n\n${lines}`
      : `🏪 *MERCADO DE KINGDOOM*\n\n${lines}`;
  }

  if (text.startsWith('!item')) {
    const query = rawText.replace(/^!item\s*/i, '').trim();
    if (!query) return `🗡️ Usa: *!item Nombre del arma*`;

    const item = await getMarketItemDetails(query);
    if (!item) return `🗡️ No encontre un item llamado *${query}* en el mercado del reino.`;

    const lines = [
      `🗡️ *${item.name}*`,
      `${String(item.rarity ?? 'common').toUpperCase()} - ${String(item.category ?? 'others').toUpperCase()} - 🪙 ${Number(item.price ?? 0).toLocaleString('es-PY')}`,
      `Estado: *${formatStock(item)}*`,
    ];

    if (item.ability) {
      lines.push(`Habilidad: ${clipText(item.ability, 110)}`);
    } else {
      lines.push(clipText(item.description, 130));
    }

    return lines.join('\n');
  }

  if (text === '!mision') {
    const missions = await getActiveMissions();
    if (!missions.length) return `📜 No hay misiones abiertas en este momento.`;
    return `📜 *MISIONES ABIERTAS*\n\n${missions.map(formatMissionRow).join('\n')}\n\nUsa *!mision nombre* para ver una en detalle.`;
  }

  if (text.startsWith('!mision ')) {
    const query = rawText.replace(/^!mision\s*/i, '').trim();
    const mission = await getMissionDetails(query);
    if (!mission) return `📜 No encontre una mision llamada *${query}*.`;

    return `📜 *${mission.title}*\n${String(mission.difficulty).toUpperCase()} - ${String(mission.type).toUpperCase()} - 🪙 ${Number(mission.reward_gold ?? 0).toLocaleString('es-PY')}\nCupo: *${mission.max_participants ?? 1}* - Estado: *${formatStatus(mission.status)}*\n${clipText(mission.description || mission.instructions, 140)}`;
  }

  if (text === '!evento') {
    const events = await getActiveEvents();
    if (!events.length) return `🎭 No hay eventos abiertos ni en produccion ahora mismo.`;
    return `🎭 *EVENTOS DEL REINO*\n\n${events.map(formatEventRow).join('\n')}\n\nUsa *!evento nombre* para ver uno en detalle.`;
  }

  if (text.startsWith('!evento ')) {
    const query = rawText.replace(/^!evento\s*/i, '').trim();
    const event = await getEventDetails(query);
    if (!event) return `🎭 No encontre un evento llamado *${query}*.`;

    return `🎭 *${event.title}*\n${formatStatus(event.status)} - Inicio: *${event.start_date || '-'}*\nCierre: *${event.end_date || '-'}* - 🎁 ${Number(event.participation_reward_gold ?? 0).toLocaleString('es-PY')} oro\n${clipText(event.description || event.long_description || event.rewards, 140)}`;
  }


  if (text === '!reino' || text === '!resumen') {
    const snapshot = await getRealmSnapshot();
    return `🏰 *ESTADO DEL REINO*\n\n👥 Aventureros: *${snapshot.totalPlayers}*\n🏪 Mercado activo: *${snapshot.availableItems}* articulos\n👑 Mas rico: *${snapshot.richest?.username ?? '-'}* (${(snapshot.richest?.gold ?? 0).toLocaleString('es-PY')} oro)\n🏆 Lider semanal: *${snapshot.weeklyChampion?.username ?? '-'}* (${(snapshot.weeklyChampion?.weekly_gold ?? 0).toLocaleString('es-PY')} oro)`;
  }

  if (text === '!ayuda') {
    return `📜 *Comandos del Reino:*\n\n🪙 !oro\n🛡️ !perfil\n🏆 !ranking\n👑 !ricos\n🏪 !mercado [nombre]\n🗡️ !item <nombre>\n📜 !mision [nombre]\n🎭 !evento [nombre]\n🎲 !dados <monto>\n🔮 !oraculo <pregunta>\n❓ !ayuda`;
  }

  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  const history = chatHistory.get(chatId);

  const contextMsg = `[Jugador: ${player.username} | Oro: ${player.gold}]\n\nMensaje: ${msg.body}`;
  history.push({ role: 'user', content: contextMsg });

  if (history.length > 16) history.splice(0, 2);

  try {
    const reply = await askKingdoomAI(history, SYSTEM_PROMPT);
    history.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err) {
    console.error('[handlePlayerMessage IA]', err.message);
    history.pop();
    return `🔥 El oraculo no responde en este momento. Intenta de nuevo.`;
  }
}
