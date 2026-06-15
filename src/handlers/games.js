import { randomInt } from 'crypto';
import { getPlayer, updateGold, getDadosUsage, incrementDadosUsage, getCofreUsage, incrementCofreUsage, getTrampaUsage, incrementTrampaUsage, getKnowledgeDocuments, pickKnowledgeContext, getPlayerSheet, getPlayerInventory, getActiveMissions, getActiveEvents } from '../supabase.js';
import { askKingdoomAI } from '../ai.js';
import { heraldCard, heraldStat } from '../formatting.js';

const DAILY_MAX_COFRE = 4;
const DAILY_MAX_TRAMPA = 4;

const COFRE_TABLE = [
  { chance: 22, gold: 0, label: 'Cofre vacio.' },
  { chance: 27, gold: 2000, label: '+2.000 oro' },
  { chance: 22, gold: 5000, label: '+5.000 oro' },
  { chance: 15, gold: 10000, label: '+10.000 oro' },
  { chance: 8, gold: 20000, label: '+20.000 oro' },
  { chance: 4, gold: 35000, label: '+35.000 oro' },
  { chance: 2, gold: 50000, label: '+50.000 oro' },
];

const TRAMPA_TABLE = [
  { chance: 35, multiplier: 0, label: 'Perdiste la apuesta.' },
  { chance: 25, multiplier: 1, label: 'Recuperaste exactamente tu apuesta.' },
  { chance: 18, multiplier: 1.25, label: 'Ganaste poco (+25%).' },
  { chance: 10, multiplier: 1.5, label: 'Ganaste medio (+50%).' },
  { chance: 7, multiplier: 1.75, label: 'Ganaste alto (+75%).' },
  { chance: 5, multiplier: 2, label: 'Jackpot x2.' },
];

function formatGold(value) {
  return Number(value ?? 0).toLocaleString('es-PY');
}

function isWeekendDay(date = new Date()) {
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

function resolveWeightedResult(table) {
  const roll = randomInt(0, 100);
  let threshold = 0;

  for (const entry of table) {
    threshold += entry.chance;
    if (roll < threshold) {
      return entry;
    }
  }

  return table[table.length - 1];
}


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
  const maxUsos = isWeekend ? 5 : 4;
  const maxApuesta = isWeekend ? 500000 : 100000;

  if (apuesta > maxApuesta) {
    return `🎲 La apuesta maxima por ronda es de *${maxApuesta.toLocaleString('es-PY')} oro*${isWeekend ? ' durante el fin de semana' : ''}.`;
  }

  const currentUsos = await getDadosUsage(player.id);
  if (currentUsos >= maxUsos) {
    return `🎲 Alcanzaste el límite diario de dados (${maxUsos}/${maxUsos}). ¡Volvé mañana para probar tu suerte!`;
  }

  const d1 = randomInt(1, 7);
  const d2 = randomInt(1, 7);
  const suma = d1 + d2;
  const gano = suma >= 7;
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


export async function handleCofre(msg) {
  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);

  if (!player) return `No estas registrado. Escribi *!registrar TuNombre*`;

  const currentUsos = await getCofreUsage(player.id);
  if (currentUsos >= DAILY_MAX_COFRE) {
    return `Alcanzaste el limite diario de cofres (${DAILY_MAX_COFRE}/${DAILY_MAX_COFRE}). Vuelve manana para abrir otro.`;
  }

  const result = resolveWeightedResult(COFRE_TABLE);
  const nextUsos = currentUsos + 1;
  const nuevoTotal = player.gold + result.gold;

  try {
    if (result.gold > 0) {
      await updateGold(player.id, result.gold);
    }
    await incrementCofreUsage(player.id);
  } catch {
    return `Error al abrir el cofre. Intenta de nuevo.`;
  }

  return heraldCard('Cofre del Reino', [
    `${player.username} abrio un cofre antiguo...`,
    `Resultado: ${result.label}`,
    heraldStat('Usos restantes', `${DAILY_MAX_COFRE - nextUsos}/${DAILY_MAX_COFRE}`),
    heraldStat('Nuevo total', `${formatGold(nuevoTotal)} oro`),
  ], { icon: '' });
}

export async function handleTrampa(msg) {
  const parts = msg.body.split(' ');
  const apuesta = parseInt((parts[1] ?? '').replace(/\./g, ''), 10);
  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);

  if (!player) return `No estas registrado. Escribi *!registrar TuNombre*`;
  if (!apuesta || isNaN(apuesta) || apuesta < 10) return `Usa: *!trampa 100* (minimo 10 oro)`;
  if (apuesta > player.gold) return `No tenes suficiente oro.\nTenes: ${formatGold(player.gold)}`;

  const weekend = isWeekendDay();
  const maxApuesta = weekend ? 500000 : 100000;
  if (apuesta > maxApuesta) {
    return `La apuesta maxima por ronda es de *${formatGold(maxApuesta)} oro*${weekend ? ' durante el fin de semana' : ''}.`;
  }

  const currentUsos = await getTrampaUsage(player.id);
  if (currentUsos >= DAILY_MAX_TRAMPA) {
    return `Alcanzaste el limite diario de trampas (${DAILY_MAX_TRAMPA}/${DAILY_MAX_TRAMPA}). Vuelve manana para tentar a la suerte.`;
  }

  const result = resolveWeightedResult(TRAMPA_TABLE);
  const retorno = Math.floor(apuesta * result.multiplier);
  const deltaNeto = retorno - apuesta;
  const nextUsos = currentUsos + 1;
  const nuevoTotal = player.gold + deltaNeto;

  try {
    if (deltaNeto !== 0) {
      await updateGold(player.id, deltaNeto);
    }
    await incrementTrampaUsage(player.id);
  } catch {
    return `Error al activar la trampa. Intenta de nuevo.`;
  }

  const resultadoEconomico = deltaNeto > 0
    ? `+${formatGold(deltaNeto)} oro netos`
    : deltaNeto < 0
      ? `-${formatGold(Math.abs(deltaNeto))} oro`
      : `Sin perdida ni ganancia`;

  return heraldCard('Trampa del Reino', [
    `${player.username} activo un mecanismo oscuro...`,
    `Resultado: ${result.label}`,
    resultadoEconomico,
    heraldStat('Usos restantes', `${DAILY_MAX_TRAMPA - nextUsos}/${DAILY_MAX_TRAMPA}`),
    heraldStat('Nuevo total', `${formatGold(nuevoTotal)} oro`),
  ], { icon: '' });
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
    let contextStr = `\n\n=== REGLAS DEL ORACULO ===\nEres el Oráculo de Kingdoom. Ya NO hablas con poesía barata ni rimas clichés de fantasía. Eres un vidente veterano, sabio pero cansado y cínico (al estilo The Witcher). Eres directo, realista y de pocas pulgas, pero NO eres un maleducado, NO insultas gratuitamente y NO usas groserías baratas ni jergas modernas (como "chaval" o "joder"). Tu tono es el de alguien que ha visto demasiado mundo.\nHablas de forma coloquial y de taberna, ambientado en la fantasía oscura.\nTu extensión máxima puede ser de hasta 3 párrafos si necesitas dar un consejo sabio, pero puedes ser breve y tajante si te apetece.\nSi te preguntan algo técnico o fuera del juego (Off-Rol), respóndelo integrándolo de forma realista como "magia extraña de otros mundos" o "asuntos de los dioses".\nNunca rompas el personaje.
    
    Tu soberano real es el usuario administrador "Nothing". Si alguien menciona "E.XE", entiendes que es un alias antiguo o una forma vieja de referirse al mismo soberano, pero tu forma preferida y actual es "Nothing".
    El usuario te hará una pregunta. Responde SIEMPRE dentro de tu personaje. 
    NO uses asteriscos para acciones (ej. *suspira*), solo habla tu mensaje.

    REGLA CRÍTICA SOBRE EL INVENTARIO:
    Si el jugador te pregunta explícitamente "¿cuál es mi inventario?" o "¿qué objetos tengo?", DÍSELO DIRECTAMENTE enumerando los objetos que ves en su "Inventario Real". No lo mandes a mirar su tomo, díselo tú.
    Si pregunta por un tipo específico de objeto (ej. "mis armas") y no tiene armas pero SÍ tiene otras cosas, menciónalo sutilmente (ej. "No veo espadas en tu destino, pero al menos ese Jubón te protegerá del frío"). Sé útil con la información de su inventario.
    
    REGLA CRÍTICA SOBRE OTROS JUGADORES: 
    Solo conoces la fortuna de quien te habla. Si preguntan por el oro, nivel o secretos de OTRO aventurero, niégate: "No me pagan por espiar bolsillos ajenos" o "Vigila tu propia espalda". ¡NO inventes datos para otras personas!
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
        contextStr += `\nFicha de Personaje (Rol):\n- Nombre: ${sheet.name}\n- Raza: ${sheet.race}\n- Origen: ${sheet.birthRealm}\n- Poderes: ${sheet.powers}\n- Arma original: ${sheet.weapon}\n- Personalidad: ${sheet.personality}\n`;
      }

      const inventory = await getPlayerInventory(player.id);
      if (inventory && inventory.length > 0) {
        const inventoryStr = inventory.map(i => `${i.quantity}x ${i.item_name || i.item_id}`).join(', ');
        contextStr += `\nInventario Real (comprado en el mercado con oro): ${inventoryStr}\n`;
      } else {
        contextStr += `\nInventario Real: El jugador NO TIENE NINGÚN OBJETO. Sus bolsillos están totalmente vacíos.\n`;
      }

      if (sheet) {
        contextStr += `(Usa la información de la ficha y su inventario real de forma SUTIL en tu profecía, como guiños. IMPORTANTE: NO menciones su cantidad de oro a menos que sea estrictamente relevante para la pregunta. Varía tus menciones: a veces háblale sobre su equipo, a veces sobre su raza, no menciones todo a la vez).\n`;
      } else {
        contextStr += `(Usa su nombre e inventario real en tu profecía. IMPORTANTE: NO menciones su cantidad de oro en cada respuesta, hazlo solo si la pregunta tiene que ver con riqueza o destino. Este jugador no tiene ficha de rol registrada aún).\n`;
      }
    } else {
      contextStr += `El jugador es un alma forastera, no registrada en el censo. Llámalo "alma sin nombre".\n`;
    }

    // 3. Estadísticas globales (opcional)
    const [missions, events] = await Promise.all([
      getActiveMissions(3),
      getActiveEvents(3)
    ]);

    if (missions && missions.length > 0) {
      contextStr += `\nMisiones Activas en el Reino:\n` + missions.map(m => `- ${m.title} (Recompensa: ${m.reward_gold} oro). Descripcion: ${m.description}`).join('\n') + `\n`;
    }
    
    if (events && events.length > 0) {
      contextStr += `\nEventos Actuales en el Reino:\n` + events.map(e => `- ${e.title}: ${e.description}`).join('\n') + `\n`;
    }

    contextStr += `(Si el jugador te pregunta sobre misiones o eventos, utiliza esta información para guiarlo y motivarlo a participar. Si no pregunta, puedes mencionarlos brevemente como rumores si encajan en tu profecía).\n`;

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
