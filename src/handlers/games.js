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

export async function handleOraculo(msg) {
  const pregunta = msg.body.replace(/^!oraculo\s*/i, '').trim();
  if (!pregunta) return `🔮 Formulá tu pregunta: *!oraculo ¿Cuándo llegará el invierno?*`;

  try {
    const documents = await getKnowledgeDocuments();
    const relevantDocs = pickKnowledgeContext(documents, pregunta, 2);
    
    let contextStr = '';
    if (relevantDocs.length > 0) {
      contextStr = `\n\n=== CONTEXTO DEL REINO ===\nUtiliza esta información confidencial para responder de forma precisa, pero mantén siempre tu tono poético y críptico.\n\n`;
      relevantDocs.forEach(doc => {
        contextStr += `* ${doc.title} (${doc.category}): ${doc.summary || doc.content.substring(0, 500)}\n`;
      });
    }

    const respuesta = await askKingdoomAI(
      [{ role: 'user', content: pregunta }],
      `Eres el Oráculo Eterno de Kingdoom — Reino de las Sombras.
       Respondés profecías crípticas y misteriosas en exactamente 2-3 líneas.
       Siempre en tono épico medieval. Usás metáforas de sombras, llamas y destino.
       Nunca rompas el personaje.` + contextStr
    );
    return heraldCard('El oraculo habla', [`_${respuesta}_`], { icon: '🔮' });
  } catch (err) {
    console.error('[handleOraculo]', err.message);
    return `🔮 El oráculo guarda silencio... intentá de nuevo más tarde.`;
  }
}
