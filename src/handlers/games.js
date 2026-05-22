import { getPlayer, updateGold, getDadosUsage, incrementDadosUsage, getKnowledgeDocuments, pickKnowledgeContext } from '../supabase.js';
import { askKingdoomAI } from '../ai.js';
import { heraldCard, heraldStat } from '../formatting.js';

export async function handleDados(msg) {
  const parts = msg.body.split(' ');
  const apuesta = parseInt(parts[1]);
  const sender = msg.author || msg.from; // msg.from = group ID in group chats
  const player = await getPlayer(sender);

  if (!player) return `⚔️ No estás registrado. Escribí *!registrar TuNombre*`;
  if (!apuesta || isNaN(apuesta) || apuesta < 10) return `🎲 Usá: *!dados 100* (mínimo 10 oro)`;
  if (apuesta > player.gold) return `❌ No tenés suficiente oro.\n🪙 Tenés: ${player.gold.toLocaleString('es-PY')}`;

  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const maxUsos = isWeekend ? 5 : 3;

  const currentUsos = await getDadosUsage(player.id);
  if (currentUsos >= maxUsos) {
    return `🎲 Alcanzaste el límite diario de dados (${maxUsos}/${maxUsos}). ¡Volvé mañana para probar tu suerte!`;
  }

  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  const suma = d1 + d2;
  const gano = suma >= 8;
  const delta = gano ? apuesta : -apuesta;
  const nuevoTotal = player.gold + delta; // calculamos antes del await

  try {
    await updateGold(player.id, delta);
    await incrementDadosUsage(player.id);
  } catch {
    return `⚔️ Error al registrar la apuesta. Intentá de nuevo.`;
  }

  const remainingUsos = maxUsos - (currentUsos + 1);
  return heraldCard('Dados del destino', [
    `Dados: [${d1}] [${d2}] = *${suma}*`,
    gano ? `✨ *Victoria* +${apuesta} oro` : `💀 *Derrota* -${apuesta} oro`,
    heraldStat('Nuevo total', `${nuevoTotal.toLocaleString('es-PY')} oro`),
    heraldStat('Usos restantes', `${remainingUsos}/${maxUsos}`),
  ], { icon: '🎲' });
}

const oraculoMemory = new Map();

export async function handleOraculo(msg) {
  const pregunta = msg.body.replace(/^!oraculo\s*/i, '').trim();
  if (!pregunta) return `🔮 Formulá tu pregunta: *!oraculo ¿Cuándo llegará el invierno?*`;

  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);
  const chatId = msg.from;

  if (!oraculoMemory.has(chatId)) {
    oraculoMemory.set(chatId, []);
  }
  const history = oraculoMemory.get(chatId);

  try {
    const documents = await getKnowledgeDocuments();
    const relevantDocs = pickKnowledgeContext(documents, pregunta, 2);
    
    // 1. Contexto del Reino y Secretos
    let contextStr = `\n\n=== REGLAS DEL ORACULO ===\nEres el Oráculo Eterno de Kingdoom — Reino de las Sombras.\nRespondés profecías crípticas y misteriosas en exactamente 2-3 líneas.\nSiempre en tono épico medieval. Usás metáforas de sombras, llamas y destino.\nNunca rompas el personaje.\n`;
    
    if (relevantDocs.length > 0) {
      contextStr += `\n=== CONOCIMIENTO SECRETO DEL REINO ===\nUtiliza esta información confidencial para responder de forma precisa:\n`;
      relevantDocs.forEach(doc => {
        contextStr += `* ${doc.title} (${doc.category}): ${doc.summary || doc.content.substring(0, 500)}\n`;
      });
    }

    // 2. Contexto del Jugador
    contextStr += `\n=== CONTEXTO DEL AVENTURERO ===\n`;
    if (player) {
      contextStr += `Nombre: ${player.username}\nOro: ${player.gold}\n(Usa este nombre en tu profecía. Si tiene poco oro (menos de 500), sé despectivo o compasivo. Si tiene mucho, adviértele sobre la codicia y traición).\n`;
    } else {
      contextStr += `El jugador es un alma forastera, no registrada en el censo. Llámalo "alma sin nombre".\n`;
    }

    // 3. Estadísticas globales (opcional, sin await pesados para evitar lag, usamos una aproximación o la omitimos si es lento, pero ya estamos usando DB).
    // Para simplificar, omitiremos el cálculo pesado de todos los jugadores si no es necesario, pero agregaremos un toque si el prompt pregunta por "el más rico".

    // Agregar pregunta al historial
    history.push({ role: 'user', content: pregunta });

    const respuesta = await askKingdoomAI(
      history,
      contextStr
    );
    
    // Guardar respuesta y mantener solo los últimos 6 mensajes (3 interacciones)
    history.push({ role: 'assistant', content: respuesta });
    if (history.length > 6) {
      history.splice(0, history.length - 6);
    }

    return heraldCard('El oraculo habla', [`_${respuesta}_`], { icon: '🔮' });
  } catch (err) {
    console.error('[handleOraculo]', err.message);
    return `🔮 El oráculo guarda silencio... intentá de nuevo más tarde.`;
  }
}
