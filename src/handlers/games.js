import { getPlayer, updateGold, getDadosUsage, incrementDadosUsage, getCofreUsage, incrementCofreUsage, getTrampaUsage, incrementTrampaUsage, getKnowledgeDocuments, pickKnowledgeContext, getPlayerSheet, getPlayerInventory, getActiveMissions, getActiveEvents, placeBet, resolveBet } from '../supabase.js';
import { askKingdoomAI, describeAIError } from '../ai.js';
import { heraldCard, heraldStat } from '../formatting.js';
import crypto from 'crypto';

const DAILY_MAX_COFRE = 4;
const DAILY_MAX_TRAMPA = 4;
const DADOS_X4_TARGET = 7;
const DADOS_X4_RUNS = 4;

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
  // Use crypto.randomInt for random integer from [0, 9999] mapped to 0.0-99.99
  const roll = crypto.randomInt(0, 10000) / 100;
  let threshold = 0;

  for (const entry of table) {
    threshold += entry.chance;
    if (roll < threshold) {
      return entry;
    }
  }

  return table[table.length - 1];
}

function parseGoldToken(value) {
  return parseInt(String(value ?? '').replace(/\./g, ''), 10);
}

function parseDadosBetConfig(body) {
  const tokens = String(body ?? '')
    .trim()
    .split(/\s+/)
    .slice(1)
    .filter(Boolean);

  const x4 = tokens.some((token) => token.toLowerCase() === 'x4');
  const amountToken = tokens.find((token) => /^\d[\d.]*$/.test(token)) ?? '';

  return {
    x4,
    amount: parseGoldToken(amountToken),
  };
}

async function applyGoldAndUsage(playerId, delta, consumeUsage) {
  let goldApplied = false;

  try {
    if (delta !== 0) {
      await updateGold(playerId, delta);
      goldApplied = true;
    }

    await consumeUsage(playerId);
    return true;
  } catch (error) {
    if (goldApplied && delta !== 0) {
      try {
        await updateGold(playerId, -delta);
      } catch (rollbackError) {
        console.error('[applyGoldAndUsage rollback]', rollbackError?.message ?? rollbackError);
      }
    }

    throw error;
  }
}


export async function handleDados(msg) {
  const { amount: apuesta, x4 } = parseDadosBetConfig(msg.body);
  const sender = msg.author || msg.from; // msg.from = group ID in group chats
  const player = await getPlayer(sender);

  if (!player) return 'No estas registrado. Escribi *!registrar TuNombre*';
  if (!apuesta || isNaN(apuesta) || apuesta < 10) return 'Usa: *!dados 100* o *!dados 100 x4* (minimo 10 oro)';
  if (apuesta > player.gold) return `No tenes suficiente oro.\nTenes: ${player.gold.toLocaleString('es-PY')}`;

  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const maxUsos = isWeekend ? 5 : 4;
  const maxApuesta = isWeekend ? 500000 : 100000;

  if (apuesta > maxApuesta) {
    return `La apuesta maxima por ronda es de *${maxApuesta.toLocaleString('es-PY')} oro*${isWeekend ? ' durante el fin de semana' : ''}.`;
  }

  const currentUsos = await getDadosUsage(player.id);
  if (currentUsos >= maxUsos) {
    return `Alcanzaste el limite diario de dados (${maxUsos}/${maxUsos}). Vuelve manana para probar tu suerte.`;
  }

  const runs = x4 ? Math.min(DADOS_X4_RUNS, maxUsos - currentUsos) : 1;
  const totalExposure = apuesta * runs;

  if (runs > 1 && totalExposure > player.gold) {
    return `No tenes suficiente oro para jugar *x4* con ${runs} tiradas.\nApuesta total de riesgo: *${formatGold(totalExposure)} oro*\nTenes: ${formatGold(player.gold)}`;
  }

  let betId;
  try {
    betId = await placeBet(player.id, totalExposure, 'dados');
    await incrementDadosUsage(player.id, runs);
  } catch {
    return 'Error al registrar la apuesta. Intenta de nuevo.';
  }

  let totalDelta = 0;
  let wins = 0;
  const rolls = [];
  let payout = 0;

  for (let index = 0; index < runs; index += 1) {
    const d1 = crypto.randomInt(1, 7);
    const d2 = crypto.randomInt(1, 7);
    const suma = d1 + d2;
    const gano = suma >= DADOS_X4_TARGET;
    const delta = gano ? apuesta * (x4 ? 4 : 1) : -apuesta;
    
    if (gano) {
      payout += apuesta + (apuesta * (x4 ? 4 : 1)); // Exposure + winnings
    }

    totalDelta += delta;
    if (gano) {
      wins += 1;
    }

    rolls.push(
      runs === 1
        ? `Dados: [${d1}] [${d2}] = *${suma}*`
        : `Tirada ${index + 1}: [${d1}] [${d2}] = *${suma}* ${gano ? `+${formatGold(delta)}` : `-${formatGold(apuesta)}`}`
    );
  }

  try {
    await resolveBet(betId, payout);
  } catch (err) {
    console.error('[handleDados] resolveBet error:', err);
  }

  const remainingUsos = maxUsos - (currentUsos + runs);
  const refreshedPlayer = await getPlayer(sender);
  const nuevoTotal = refreshedPlayer?.gold ?? (player.gold + totalDelta);
  const resultLine = totalDelta > 0
    ? `Victoria total: +${formatGold(totalDelta)} oro`
    : totalDelta < 0
      ? `Derrota total: -${formatGold(Math.abs(totalDelta))} oro`
      : 'Resultado neutro: sin ganancia ni perdida';

  return heraldCard('Dados del destino', [
    x4
      ? `Modo: *x4* (${runs} tiradas en cadena, ganas con suma de ${DADOS_X4_TARGET} o mas)`
      : `Modo: *clasico* (ganas con ${DADOS_X4_TARGET} o mas)`,
    ...rolls,
    runs > 1 ? `Victorias: *${wins}/${runs}*` : '',
    resultLine,
    heraldStat('Nuevo total', `${nuevoTotal.toLocaleString('es-PY')} oro`),
    heraldStat('Usos restantes', `${remainingUsos}/${maxUsos}`),
  ], { icon: '' });
}

export async function handleCofre(msg) {
  const parts = msg.body.toLowerCase().split(' ');
  const multiplierMatch = parts.find(p => p.match(/^x?[1-9]\d*$/));
  const requestedMultiplier = multiplierMatch ? parseInt(multiplierMatch.replace('x', ''), 10) : 1;

  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);

  if (!player) return `No estas registrado. Escribi *!registrar TuNombre*`;

  const currentUsos = await getCofreUsage(player.id);
  if (currentUsos >= DAILY_MAX_COFRE) {
    return `Alcanzaste el limite diario de cofres (${DAILY_MAX_COFRE}/${DAILY_MAX_COFRE}). Vuelve manana para abrir otro.`;
  }

  const runs = Math.min(requestedMultiplier, DAILY_MAX_COFRE - currentUsos);

  let totalGold = 0;
  const results = [];

  for (let i = 0; i < runs; i++) {
    const result = resolveWeightedResult(COFRE_TABLE);
    totalGold += result.gold;
    results.push(result.label);
  }

  const nextUsos = currentUsos + runs;

  try {
    await applyGoldAndUsage(player.id, totalGold, (targetPlayerId) =>
      incrementCofreUsage(targetPlayerId, runs)
    );
  } catch {
    return `Error al abrir los cofres. Intenta de nuevo.`;
  }

  const refreshedPlayer = await getPlayer(sender);
  const nuevoTotal = refreshedPlayer?.gold ?? (player.gold + totalGold);

  const resultString = runs === 1 
    ? `Resultado: ${results[0]}` 
    : `Resultados: ${results.join(', ')}`;

  const header = runs === 1
    ? `${player.username} abrio un cofre antiguo...`
    : `${player.username} abrio ${runs} cofres antiguos simultaneamente...`;

  return heraldCard('Cofre del Reino', [
    header,
    resultString,
    runs > 1 ? `Oro total ganado: +${formatGold(totalGold)}` : '',
    heraldStat('Usos restantes', `${DAILY_MAX_COFRE - nextUsos}/${DAILY_MAX_COFRE}`),
    heraldStat('Nuevo total', `${formatGold(nuevoTotal)} oro`),
  ].filter(Boolean), { icon: '' });
}

export async function handleTrampa(msg) {
  const parts = msg.body.toLowerCase().split(' ');
  const apuesta = parseInt((parts[1] ?? '').replace(/\./g, ''), 10);
  const multiplierMatch = parts.slice(2).find(p => p.match(/^x?[1-9]\d*$/));
  const requestedMultiplier = multiplierMatch ? parseInt(multiplierMatch.replace('x', ''), 10) : 1;
  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);

  if (!player) return `No estas registrado. Escribi *!registrar TuNombre*`;
  if (!apuesta || isNaN(apuesta) || apuesta < 10) return `Usa: *!trampa 100* (minimo 10 oro)`;

  const weekend = isWeekendDay();
  const maxApuesta = weekend ? 500000 : 100000;
  if (apuesta > maxApuesta) {
    return `La apuesta maxima por ronda es de *${formatGold(maxApuesta)} oro*${weekend ? ' durante el fin de semana' : ''}.`;
  }

  const currentUsos = await getTrampaUsage(player.id);
  if (currentUsos >= DAILY_MAX_TRAMPA) {
    return `Alcanzaste el limite diario de trampas (${DAILY_MAX_TRAMPA}/${DAILY_MAX_TRAMPA}). Vuelve manana para tentar a la suerte.`;
  }

  const runs = Math.min(requestedMultiplier, DAILY_MAX_TRAMPA - currentUsos);
  const totalApuesta = apuesta * runs;

  if (totalApuesta > player.gold) {
    return `No tenes suficiente oro para apostar ${formatGold(apuesta)} x${runs} (${formatGold(totalApuesta)} oro en total).\nTenes: ${formatGold(player.gold)}`;
  }

  let betId;
  try {
    betId = await placeBet(player.id, totalApuesta, 'trampa');
    await incrementTrampaUsage(player.id, runs);
  } catch {
    return `Error al activar la trampa. Intenta de nuevo.`;
  }

  let totalRetorno = 0;
  const results = [];

  for (let i = 0; i < runs; i++) {
    const result = resolveWeightedResult(TRAMPA_TABLE);
    const retorno = Math.floor(apuesta * result.multiplier);
    totalRetorno += retorno;
    // simplificar la etiqueta (ej. "Recuperaste exactamente tu apuesta." -> "Recuperaste exactamente tu apuesta")
    results.push(result.label.replace(/\.$/, ''));
  }

  const deltaNeto = totalRetorno - totalApuesta;
  const nextUsos = currentUsos + runs;

  try {
    await resolveBet(betId, totalRetorno);
  } catch (err) {
    console.error('[handleTrampa] resolveBet error:', err);
  }

  const refreshedPlayer = await getPlayer(sender);
  const nuevoTotal = refreshedPlayer?.gold ?? (player.gold + deltaNeto);

  const resultadoEconomico = deltaNeto > 0
    ? `+${formatGold(deltaNeto)} oro netos`
    : deltaNeto < 0
      ? `-${formatGold(Math.abs(deltaNeto))} oro`
      : `Sin perdida ni ganancia`;

  const resultString = runs === 1 
    ? `Resultado: ${results[0]}.` 
    : `Resultados: ${results.join(', ')}.`;

  const header = runs === 1
    ? `${player.username} activo un mecanismo oscuro...`
    : `${player.username} activo ${runs} mecanismos oscuros simultaneamente...`;

  return heraldCard('Trampa del Reino', [
    header,
    resultString,
    runs > 1 ? `Apuesta total: ${formatGold(totalApuesta)}` : '',
    resultadoEconomico,
    heraldStat('Usos restantes', `${DAILY_MAX_TRAMPA - nextUsos}/${DAILY_MAX_TRAMPA}`),
    heraldStat('Nuevo total', `${formatGold(nuevoTotal)} oro`),
  ].filter(Boolean), { icon: '' });
}

const oraculoMemory = new Map();

function normalizeOracleText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildOracleMemoryKey(chatId, playerId, sender) {
  return `${chatId}::${playerId || sender || 'unknown'}`;
}

function buildOracleDocSnippet(document, question) {
  const summary = String(document.summary ?? '').trim();
  const content = String(document.content ?? '').trim();
  if (!content) return summary;

  const normalizedQuestion = normalizeOracleText(question);
  const tokens = normalizedQuestion
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/g)
    .filter((token) => token.length > 3);

  const normalizedContent = normalizeOracleText(content);
  const firstMatch = tokens.find((token) => normalizedContent.includes(token));
  if (!firstMatch) {
    return summary || content.substring(0, 500);
  }

  const matchIndex = normalizedContent.indexOf(firstMatch);
  const start = Math.max(0, matchIndex - 180);
  const end = Math.min(content.length, matchIndex + 320);
  const excerpt = content.slice(start, end).trim();
  return summary ? `${summary}\nFragmento: ${excerpt}` : excerpt;
}

export async function handleOraculo(msg) {
  const pregunta = msg.body.replace(/^!oraculo\s*/i, '').trim();
  if (!pregunta) return `ðŸ”® FormulÃ¡ tu pregunta: *!oraculo Â¿CuÃ¡ndo llegarÃ¡ el invierno?*`;

  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);
  const chatId = msg.from;
  const memoryKey = buildOracleMemoryKey(chatId, player?.id, sender);

  if (!oraculoMemory.has(memoryKey)) {
    oraculoMemory.set(memoryKey, []);
  }
  const history = oraculoMemory.get(memoryKey);

  try {
    const [documents, sheet, inventory, missions, events] = await Promise.all([
      getKnowledgeDocuments(),
      player ? getPlayerSheet(player.id) : Promise.resolve(null),
      player ? getPlayerInventory(player.id) : Promise.resolve(null),
      getActiveMissions(3),
      getActiveEvents(3),
    ]);
    const relevantDocs = pickKnowledgeContext(documents, pregunta, 4);
    
    // 1. Reglas base del sistema
    let contextStr = `\n\n=== REGLAS DEL ORACULO ===\nEres el OrÃ¡culo de Kingdoom. Ya NO hablas con poesÃ­a barata ni rimas clichÃ©s de fantasÃ­a. Eres un vidente veterano, sabio pero cansado y cÃ­nico (al estilo The Witcher). Eres directo, realista y de pocas pulgas, pero NO eres un maleducado, NO insultas gratuitamente y NO usas groserÃ­as baratas ni jergas modernas (como "chaval" o "joder"). Tu tono es el de alguien que ha visto demasiado mundo.\nHablas de forma coloquial y de taberna, ambientado en la fantasÃ­a oscura.\nTu extensiÃ³n mÃ¡xima puede ser de hasta 3 pÃ¡rrafos si necesitas dar un consejo sabio, pero puedes ser breve y tajante si te apetece.\nSi te preguntan algo tÃ©cnico o fuera del juego (Off-Rol), respÃ³ndelo integrÃ¡ndolo de forma realista como "magia extraÃ±a de otros mundos" o "asuntos de los dioses".\nNunca rompas el personaje.
    
    Tu soberano real es el usuario administrador "Nothing". Si alguien menciona "E.XE", entiendes que es un alias antiguo o una forma vieja de referirse al mismo soberano, pero tu forma preferida y actual es "Nothing".
    El usuario te harÃ¡ una pregunta. Responde SIEMPRE dentro de tu personaje. 
    NO uses asteriscos para acciones (ej. *suspira*), solo habla tu mensaje.

    REGLA CRÃTICA SOBRE EL INVENTARIO:
    Si el jugador te pregunta explÃ­citamente "Â¿cuÃ¡l es mi inventario?" o "Â¿quÃ© objetos tengo?", DÃSELO DIRECTAMENTE enumerando los objetos que ves en su "Inventario Real". No lo mandes a mirar su tomo, dÃ­selo tÃº.
    Si pregunta por un tipo especÃ­fico de objeto (ej. "mis armas") y no tiene armas pero SÃ tiene otras cosas, menciÃ³nalo sutilmente (ej. "No veo espadas en tu destino, pero al menos ese JubÃ³n te protegerÃ¡ del frÃ­o"). SÃ© Ãºtil con la informaciÃ³n de su inventario.
    
    REGLA CRÃTICA SOBRE OTROS JUGADORES: 
    Solo conoces la fortuna de quien te habla. Si preguntan por el oro, nivel o secretos de OTRO aventurero, niÃ©gate: "No me pagan por espiar bolsillos ajenos" o "Vigila tu propia espalda". Â¡NO inventes datos para otras personas!
    `;
    if (relevantDocs.length > 0) {
      contextStr += `\n=== CONOCIMIENTO SECRETO DEL REINO ===\nUtiliza esta informaciÃ³n confidencial para responder de forma precisa:\n`;
      relevantDocs.forEach(doc => {
        contextStr += `* ${doc.title} (${doc.category}): ${buildOracleDocSnippet(doc, pregunta)}\n`;
      });
    }

    // 2. Contexto del Jugador y Ficha
    contextStr += `\n=== CONTEXTO DEL AVENTURERO ===\n`;
    if (player) {
      contextStr += `Jugador: ${player.username}\nOro en el banco: ${player.gold}\n`;
      
      if (sheet) {
        contextStr += `\nFicha de Personaje (Rol):\n- Nombre: ${sheet.name}\n- Raza: ${sheet.race}\n- Profesion: ${sheet.profession || 'No indicada'}\n- Origen: ${sheet.birthRealm}\n- Poderes: ${sheet.powers}\n- Arma original: ${sheet.weapon}\n- Estilo de combate: ${sheet.combatStyle || 'No indicado'}\n- Personalidad: ${sheet.personality}\n`;
        if (sheet.history) {
          contextStr += `- Historia resumida: ${String(sheet.history).substring(0, 600)}\n`;
        }
      }

      if (inventory && inventory.length > 0) {
        const inventoryStr = inventory.map(i => `${i.quantity}x ${i.item_name || i.item_id}`).join(', ');
        contextStr += `\nInventario Real (comprado en el mercado con oro): ${inventoryStr}\n`;
      } else {
        contextStr += `\nInventario Real: El jugador NO TIENE NINGÃšN OBJETO. Sus bolsillos estÃ¡n totalmente vacÃ­os.\n`;
      }

      if (sheet) {
        contextStr += `(Usa la informaciÃ³n de la ficha y su inventario real de forma SUTIL en tu profecÃ­a, como guiÃ±os. IMPORTANTE: NO menciones su cantidad de oro a menos que sea estrictamente relevante para la pregunta. VarÃ­a tus menciones: a veces hÃ¡blale sobre su equipo, a veces sobre su raza, no menciones todo a la vez).\n`;
      } else {
        contextStr += `(Usa su nombre e inventario real en tu profecÃ­a. IMPORTANTE: NO menciones su cantidad de oro en cada respuesta, hazlo solo si la pregunta tiene que ver con riqueza o destino. Este jugador no tiene ficha de rol registrada aÃºn).\n`;
      }
    } else {
      contextStr += `El jugador es un alma forastera, no registrada en el censo. LlÃ¡malo "alma sin nombre".\n`;
    }


    if (missions && missions.length > 0) {
      contextStr += `\nMisiones Activas en el Reino:\n` + missions.map(m => `- ${m.title} (Recompensa: ${m.reward_gold} oro). Descripcion: ${m.description}`).join('\n') + `\n`;
    }
    
    if (events && events.length > 0) {
      contextStr += `\nEventos Actuales en el Reino:\n` + events.map(e => `- ${e.title}: ${e.description}`).join('\n') + `\n`;
    }

    contextStr += `(Si el jugador te pregunta sobre misiones o eventos, utiliza esta informaciÃ³n para guiarlo y motivarlo a participar. Si no pregunta, puedes mencionarlos brevemente como rumores si encajan en tu profecÃ­a).\n`;

    // Agregar pregunta al historial
    history.push({ role: 'user', content: pregunta });

    const respuesta = await askKingdoomAI(
      history,
      contextStr,
      {
        maxEstimatedInputTokens: 5200,
        maxOutputTokens: 700,
        temperature: 0.85,
      }
    );
    
    // Guardar respuesta y mantener solo los Ãºltimos 6 mensajes (3 interacciones)
    history.push({ role: 'assistant', content: respuesta });
    if (history.length > 6) {
      history.splice(0, history.length - 6);
    }

    return heraldCard('El oraculo habla', [`_${respuesta}_`], { icon: 'ðŸ”®' });
  } catch (err) {
    console.error('[handleOraculo]', err.message);
    return `ðŸ”® ${describeAIError(err).userMessage}`;
  }
}
