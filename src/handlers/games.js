import { getPlayer, updateGold, getDadosUsage, incrementDadosUsage, getKnowledgeDocuments, pickKnowledgeContext, getPlayerSheet } from '../supabase.js';
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
    
    // 1. Reglas base del sistema
    let contextStr = `\n\n=== REGLAS DEL ORACULO ===\nEres el Oráculo Eterno de Kingdoom — Reino de las Sombras.\nDebes adaptar tu longitud y tono al tipo de pregunta que recibas, fluyendo naturalmente entre dar una profecía críptica breve (1-2 líneas) o una explicación más profunda y dramática si el tema lo amerita (hasta 2 párrafos cortos).\nSiempre mantén un tono épico medieval, pero sé flexible: puedes ser sabio, burlón, amenazante o poético, dependiendo de la situación y del jugador.\nSi te preguntan algo técnico o fuera del juego (Off-Rol), respóndelo de manera útil pero integrándolo siempre dentro de tu personaje como si fuera hechicería, visiones divinas o lenguas de forasteros.\nNunca rompas el personaje.
    
    Tu deidad principal o tu rey es el usuario administrador "E.XE".
    El usuario te hará una pregunta o afirmación. Responde SIEMPRE dentro de tu personaje. 
    NO uses asteriscos para acciones (ej. *suspira*), solo habla tu mensaje directamente.

    REGLA CRÍTICA SOBRE EL CONOCIMIENTO DE OTROS JUGADORES: 
    Solo conoces con exactitud la fortuna, la ficha y los secretos de quien te está hablando en este momento. Si el usuario te pregunta por el oro, el nivel, la ficha o los secretos de OTRO aventurero o de un tercero, DEBES negarte a responder inventando datos. Responde de forma misteriosa diciendo que "los hilos del destino de otros están ocultos por el velo de las sombras" o que "no revelarás los secretos ajenos a oídos codiciosos". ¡NO inventes números ni fortunas para otras personas!
    `;
    if (relevantDocs.length > 0) {
      contextStr += `\n=== CONOCIMIENTO SECRETO DEL REINO ===\nUtiliza esta información confidencial para responder de forma precisa:\n`;
      relevantDocs.forEach(doc => {
        contextStr += `* ${doc.title} (${doc.category}): ${doc.summary || doc.content.substring(0, 500)}\n`;
      });
    }

    // 2. Contexto del Jugador y Ficha
    contextStr += `\n=== CONTEXTO DEL AVENTURERO ===\n`;
    if (player) {
      contextStr += `Jugador: ${player.username}\nOro en el banco: ${player.gold}\n`;
      
      const sheet = await getPlayerSheet(player.id);
      if (sheet) {
        contextStr += `\nFicha de Personaje (Rol):\n- Nombre: ${sheet.name}\n- Raza: ${sheet.race}\n- Origen: ${sheet.birthRealm}\n- Poderes: ${sheet.powers}\n- Arma: ${sheet.weapon}\n- Personalidad: ${sheet.personality}\n`;
        contextStr += `(Usa la información de la ficha de forma SUTIL en tu profecía, como guiños. IMPORTANTE: NO menciones su cantidad de oro a menos que sea estrictamente relevante para la pregunta o si preguntas sobre fortunas. Varía tus menciones: a veces háblale sobre su arma, a veces sobre su raza, no menciones todo a la vez).\n`;
      } else {
        contextStr += `(Usa su nombre en tu profecía. IMPORTANTE: NO menciones su cantidad de oro en cada respuesta, hazlo solo si la pregunta tiene que ver con riqueza, destino o si te falta inspiración. Este jugador no tiene ficha de rol registrada aún).\n`;
      }
    } else {
      contextStr += `El jugador es un alma forastera, no registrada en el censo. Llámalo "alma sin nombre".\n`;
    }

    // 3. Estadísticas globales (opcional)
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
