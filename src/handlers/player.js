import { getPlayer, getLeaderboard, getMarketItems } from '../supabase.js';
import { askKingdoomAI } from '../ai.js';

const SYSTEM_PROMPT = `Eres el Heraldo del Reino de Kingdoom — Reino de las Sombras.
Hablas con tono medieval, misterioso y épico. Usás emojis de espadas, coronas y fuego.
Eres conciso en WhatsApp (máximo 4 líneas). Nunca rompas el personaje.
Fecha actual: ${new Date().toLocaleDateString('es-PY')}`;

// Historial de conversación por jugador (en memoria)
const chatHistory = new Map();

// ✅ Limpieza cada 6 horas para evitar memory leak
setInterval(() => {
  chatHistory.clear();
  console.log('[player] chatHistory limpiado');
}, 1000 * 60 * 60 * 6);

export async function handlePlayerMessage(msg) {
  const chatId = msg.from;
  const player = await getPlayer(chatId);

  if (!player) {
    return `⚔️ *Viajero desconocido*, no estás registrado en el reino.\n\nEscribí *!registrar TuNombre* para unirte a Kingdoom.`;
  }

  const text = msg.body.toLowerCase().trim();

  // Comandos directos (sin IA, respuesta instantánea)
  if (text === '!oro' || text === '!gold') {
    return `👑 *${player.username}*, tu fortuna actual:\n\n🪙 *${player.gold.toLocaleString()} oro*\n\n_"El oro es el aliento del reino..."_`;
  }

  if (text === '!ranking' || text === '!top') {
    const board = await getLeaderboard();
    if (!board.length) return `📊 Aún no hay guerreros en el ranking.`;
    const lines = board.map((p, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
      return `${medal} *${p.username}* — ${p.weekly_gold.toLocaleString()} oro`;
    }).join('\n');
    return `⚔️ *RANKING SEMANAL DEL REINO* ⚔️\n\n${lines}`;
  }

  if (text === '!mercado') {
    const items = await getMarketItems();
    if (!items.length) return `🏪 El mercado está vacío hoy, viajero.`;
    const lines = items.map(i => `• *${i.name}* — 🪙 ${i.price} oro`).join('\n');
    return `🏪 *MERCADO DE KINGDOOM*\n\n${lines}`;
  }

  if (text === '!ayuda') {
    return `📜 *Comandos del Reino:*\n\n🪙 !oro — Ver tu oro\n🏆 !ranking — Top 10 semanal\n🏪 !mercado — Ítems disponibles\n🎲 !dados <monto> — Apostar oro\n🔮 !oraculo <pregunta> — El oráculo responde\n❓ !ayuda — Esta lista\n\n_O simplemente habla conmigo..._`;
  }

  // IA para todo lo demás
  if (!chatHistory.has(chatId)) chatHistory.set(chatId, []);
  const history = chatHistory.get(chatId);

  const contextMsg = `[Jugador: ${player.username} | Oro: ${player.gold}]\n\nMensaje: ${msg.body}`;
  history.push({ role: 'user', content: contextMsg });

  // Mantener solo los últimos 16 mensajes
  if (history.length > 16) history.splice(0, 2);

  try {
    const reply = await askKingdoomAI(history, SYSTEM_PROMPT);
    history.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err) {
    console.error('[handlePlayerMessage IA]', err.message);
    history.pop(); // revertir el push si falló
    return `🔥 El oráculo no responde en este momento. Intentá de nuevo.`;
  }
}
