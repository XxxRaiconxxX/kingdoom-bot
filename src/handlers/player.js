import {
  getGoldLeaderboard,
  getLeaderboard,
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

function formatMarketItem(item) {
  const rarity = item.rarity ? ` - ${String(item.rarity).toUpperCase()}` : '';
  const price = Number(item.price ?? 0).toLocaleString('es-PY');
  return `• *${item.name}*${rarity} - 🪙 ${price} oro`;
}

export async function handlePlayerMessage(msg) {
  const chatId = msg.from;
  const player = await getPlayer(chatId);

  if (!player) {
    return `⚔️ *Viajero desconocido*, no estas registrado en el reino.\n\nEscribi *!registrar TuNombre* para unirte a Kingdoom.`;
  }

  const rawText = msg.body.trim();
  const text = rawText.toLowerCase();

  if (text === '!oro' || text === '!gold') {
    return `👑 *${player.username}*, tu fortuna actual:\n\n🪙 *${player.gold.toLocaleString('es-PY')} oro*\n\n_"El oro es el aliento del reino..."_`;
  }

  if (text === '!perfil' || text === '!estado') {
    return `🛡️ *PERFIL DEL AVENTURERO*\n\n` +
      `👤 *${player.username}*\n` +
      `🪙 Oro total: *${player.gold.toLocaleString('es-PY')}*\n` +
      `🏆 Oro semanal: *${(player.weekly_gold ?? 0).toLocaleString('es-PY')}*`;
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

  if (text === '!reino' || text === '!resumen') {
    const snapshot = await getRealmSnapshot();
    return `🏰 *ESTADO DEL REINO*\n\n` +
      `👥 Aventureros: *${snapshot.totalPlayers}*\n` +
      `🏪 Mercado activo: *${snapshot.availableItems}* articulos\n` +
      `👑 Mas rico: *${snapshot.richest?.username ?? '-'}* (${(snapshot.richest?.gold ?? 0).toLocaleString('es-PY')} oro)\n` +
      `🏆 Lider semanal: *${snapshot.weeklyChampion?.username ?? '-'}* (${(snapshot.weeklyChampion?.weekly_gold ?? 0).toLocaleString('es-PY')} oro)`;
  }

  if (text === '!ayuda') {
    return `📜 *Comandos del Reino:*\n\n` +
      `🪙 !oro - Ver tu oro\n` +
      `🛡️ !perfil - Ver tu estado\n` +
      `🏆 !ranking - Top semanal\n` +
      `👑 !ricos - Top por oro total\n` +
      `🏪 !mercado [nombre] - Ver o buscar items\n` +
      `🏰 !reino - Resumen del reino\n` +
      `🎲 !dados <monto> - Apostar oro\n` +
      `🔮 !oraculo <pregunta> - El oraculo responde\n` +
      `❓ !ayuda - Esta lista`;
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
