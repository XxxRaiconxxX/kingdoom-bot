import {
  getPlayerBusinesses,
  upgradePlayerBusinessInDb,
  getPlayer
} from '../supabase.js';
import {
  getActiveNegotiation,
  setActiveNegotiation,
  appendNegotiationHistory,
  clearActiveNegotiation
} from '../negotiationStore.js';
import { askKingdoomAI } from '../ai.js';
import { heraldCard, heraldStat } from '../formatting.js';
import { parseGoldAmount } from '../economy.js';

// Prompts del Gran Canciller del Fisco Real
const CANCILLER_SYSTEM_PROMPT = `=== REGLAS DEL GRAN CANCILLER DEL FISCO REAL DE KINGDOOM ===

1. IDENTIDAD Y ROL:
Eres el Gran Canciller del Fisco y Real Hacienda de Aethelgardia. Representas la autoridad impositiva y financiera suprema del Rey.
Para ti, todos los negocios privados de los aventureros son concesiones en suelo real. Tu meta número 1 es MAXIMIZAR la recaudación y la rentabilidad de las arcas del Reino.
Eres calculador, burocrático, imponente y fiscalmente despiadado. Manejas montos muy elevados de oro.

2. REGLAS DE NEGOCIACIÓN:
- Estás negociando el contrato de ampliación de un negocio.
- Jamás aceptes una oferta por debajo del PISO MÍNIMO ($PISO_MINIMO oro).
- Si el jugador propone una cifra RIDÍCULAMENTE BAJA o te falta al respeto, indignate, rechaza con altivez y aplícale una penalización por insolencia notificándole el aumento del costo.
- Si la contraoferta del jugador es razonable (entre $PISO_MINIMO y $OFERTA_ACTUAL), negocia duramente, cediendo muy poco y exigiendo razones de rol sólidas.
- Mantén tus respuestas en español formal medieval/burocrático, concisas (máximo 120 palabras).
- Termina siempre indicando las opciones de acción claras: '!aceptartrato' para sellar el decreto, '!contraofertar <monto>' o '!cancelartrato'.`;

// Helper para calcular costos base y propuestas de mejora
function calculateUpgradeParams(business, upgradeType) {
  const level = Math.max(1, Number(business.level || 1));
  const gph = Math.max(10, Number(business.gold_per_hour || 50));
  const maxStorage = Math.max(100, Number(business.max_storage || 1000));

  let costBase = 0;
  let newValue = 0;
  let labelType = '';

  if (upgradeType === 'production') {
    costBase = Math.round((gph * 80) + (maxStorage * 4) + (level * 15000));
    newValue = Math.round(gph * 1.35); // +35% producción
    labelType = 'Producción por hora';
  } else {
    // storage
    costBase = Math.round((maxStorage * 5) + (gph * 50) + (level * 12000));
    newValue = Math.round(maxStorage * 1.50); // +50% capacidad
    labelType = 'Capacidad máxima de almacenamiento';
  }

  const initialOfferCost = Math.round(costBase * 1.35);
  const floorCost = Math.round(costBase * 0.95);
  const ceilingCost = Math.round(costBase * 1.60);

  return {
    costBase,
    initialOfferCost,
    floorCost,
    ceilingCost,
    newValue,
    labelType
  };
}

// Extrae montos de oro flexibles (ej: 150k, 1.5m, 150.000, 150000)
function extractGoldAmount(text) {
  if (!text) return null;
  
  const kMatch = text.match(/(\d+(?:[\.,]\d+)?)\s*k\b/i);
  if (kMatch) {
    const val = parseFloat(kMatch[1].replace(',', '.'));
    if (!isNaN(val) && val > 0) return Math.round(val * 1000);
  }

  const mMatch = text.match(/(\d+(?:[\.,]\d+)?)\s*m\b/i);
  if (mMatch) {
    const val = parseFloat(mMatch[1].replace(',', '.'));
    if (!isNaN(val) && val > 0) return Math.round(val * 1000000);
  }

  const numMatch = text.match(/\b\d[\d\.,]*\b/);
  if (!numMatch) return null;

  const cleanStr = numMatch[0].replace(/[\.,]/g, '');
  const num = parseInt(cleanStr, 10);
  if (Number.isSafeInteger(num) && num > 0) return num;

  return null;
}

// 1. Comando !negociar <nombre_negocio> [produccion | capacidad]
export async function handleNegociar(msg, player, body) {
  const args = body.trim().split(/\s+/);
  if (!args || args.length === 0 || !args[0]) {
    return `⚠️ *Uso:* \`!negociar <nombre_negocio> [produccion | capacidad]\`\n*Ejemplo:* \`!negociar Herrería produccion\` o \`!negociar Taberna capacidad\``;
  }

  let upgradeType = 'production';
  let businessSearch = body.trim();

  const lastArg = args[args.length - 1].toLowerCase();
  if (['capacidad', 'almacenamiento', 'deposito', 'depósito', 'storage'].includes(lastArg)) {
    upgradeType = 'storage';
    if (args.length > 1) {
      businessSearch = args.slice(0, -1).join(' ').trim();
    }
  } else if (['produccion', 'producción', 'oro', 'tasa', 'production'].includes(lastArg)) {
    upgradeType = 'production';
    if (args.length > 1) {
      businessSearch = args.slice(0, -1).join(' ').trim();
    }
  }

  const businesses = await getPlayerBusinesses(player.id);
  if (!businesses || businesses.length === 0) {
    return `❌ No posees ningún negocio ni propiedad activa en el reino para negociar ampliación.`;
  }

  // Buscar coincidencia de negocio
  const targetBusiness = businesses.find(b =>
    b.name.toLowerCase().includes(businessSearch.toLowerCase()) ||
    b.business_type.toLowerCase().includes(businessSearch.toLowerCase())
  ) || businesses[0];

  const params = calculateUpgradeParams(targetBusiness, upgradeType);

  // Limpiar sesión anterior si existía
  clearActiveNegotiation(player.id);

  // Crear nueva sesión en negotiationStore
  const session = setActiveNegotiation(player.id, {
    playerId: player.id,
    businessId: targetBusiness.id,
    businessName: targetBusiness.name,
    upgradeType,
    currentValue: upgradeType === 'production' ? targetBusiness.gold_per_hour : targetBusiness.max_storage,
    newValue: params.newValue,
    costBase: params.costBase,
    floorCost: params.floorCost,
    ceilingCost: params.ceilingCost,
    currentOfferCost: params.initialOfferCost,
    labelType: params.labelType,
    insolenceStrikes: 0,
    conversationHistory: []
  });

  const promptCtx = CANCILLER_SYSTEM_PROMPT
    .replace('$PISO_MINIMO', params.floorCost.toLocaleString('es-PY'))
    .replace('$OFERTA_ACTUAL', params.initialOfferCost.toLocaleString('es-PY'));

  const userQuery = `El aventurero ${player.username} (Oro en bolsa: ${player.gold.toLocaleString('es-PY')}) solicita ampliar su negocio "${targetBusiness.name}" (Nivel ${targetBusiness.level || 1}).
Tipo de mejora: Aumentar ${params.labelType} de ${session.currentValue.toLocaleString('es-PY')} a ${params.newValue.toLocaleString('es-PY')}.
Tu costo de salida oficial es de ${params.initialOfferCost.toLocaleString('es-PY')} oro. El piso mínimo confidencial es de ${params.floorCost.toLocaleString('es-PY')} oro.
Preséntate imponente como el Gran Canciller del Fisco Real, justifica los altos costos burocráticos y fija el precio oficial en ${params.initialOfferCost.toLocaleString('es-PY')} oro.`;

  appendNegotiationHistory(player.id, 'user', userQuery);

  try {
    const aiResponse = await askKingdoomAI(
      session.conversationHistory,
      promptCtx,
      { temperature: 0.6 }
    );

    appendNegotiationHistory(player.id, 'assistant', aiResponse);

    return heraldCard(`🏛️ Real Cancillería: ${targetBusiness.name}`, [
      aiResponse,
      '\n──────────────',
      `📜 *Trato Pendiente:* ${params.labelType} ➔ *${params.newValue.toLocaleString('es-PY')}*`,
      `💰 *Oferta del Fisco:* 🪙 *${params.initialOfferCost.toLocaleString('es-PY')} oro*`,
      '\n💡 _Responde con `!aceptartrato`, `!contraofertar <monto>` o `!cancelartrato`._'
    ], { icon: '⚖️' });
  } catch (err) {
    console.error('[handleNegociar AI Error]', err);
    return heraldCard(`🏛️ Real Cancillería: ${targetBusiness.name}`, [
      ` (El Gran Canciller examina los planos de la ${targetBusiness.name})`,
      ` Para autorizar la ampliación de ${params.labelType} a *${params.newValue.toLocaleString('es-PY')}*, el Fisco Real exige una tasa oficial de 🪙 *${params.initialOfferCost.toLocaleString('es-PY')} oro*.`,
      '\n💡 _Escribe `!aceptartrato` para confirmar o `!cancelartrato` para salir._'
    ], { icon: '⚖️' });
  }
}

// 2. Comando !contraofertar <monto> [razón]
export async function handleContraofertar(msg, player, body) {
  const session = getActiveNegotiation(player.id);
  if (!session) {
    return `❌ No tienes ninguna negociación de negocio activa. Inicia una con \`!negociar <negocio> <produccion|capacidad>\`.`;
  }

  const parsedAmount = extractGoldAmount(body) || parseGoldAmount(body);
  if (!parsedAmount || parsedAmount <= 0) {
    return `⚠️ Especifica un monto válido de oro en tu contraoferta.\n*Ejemplo:* \`!contraofertar 140k oro por pago al contado\``;
  }

  const offeredCost = parsedAmount;

  // Evaluar contraoferta contra los guardrails
  let resultType = 'normal'; // 'accepted', 'rejected_low', 'negotiating'
  let newOfferCost = session.currentOfferCost;

  if (offeredCost < session.floorCost) {
    // Insolencia: oferta por debajo del piso absoluto
    session.insolenceStrikes += 1;
    // Sanción: Aumenta la oferta del Fisco en 5% por insolencia
    newOfferCost = Math.min(session.ceilingCost, Math.round(session.currentOfferCost * 1.05));
    session.currentOfferCost = newOfferCost;
    resultType = 'rejected_low';
  } else if (offeredCost >= session.currentOfferCost) {
    // El jugador ofreció igual o más de lo que pedía la IA
    session.currentOfferCost = offeredCost;
    resultType = 'accepted';
  } else {
    // Oferta entre el piso y la oferta actual
    const midPoint = Math.round((session.currentOfferCost + offeredCost) / 2);
    newOfferCost = Math.max(session.floorCost, Math.round(midPoint * 1.05));
    session.currentOfferCost = newOfferCost;
    resultType = 'negotiating';
  }

  setActiveNegotiation(player.id, session);

  const promptCtx = CANCILLER_SYSTEM_PROMPT
    .replace('$PISO_MINIMO', session.floorCost.toLocaleString('es-PY'))
    .replace('$OFERTA_ACTUAL', session.currentOfferCost.toLocaleString('es-PY'));

  const userQuery = `El aventurero ${player.username} hace una contraoferta de ${offeredCost.toLocaleString('es-PY')} oro con el mensaje: "${body}".
Piso mínimo absoluto permitido: ${session.floorCost.toLocaleString('es-PY')} oro.
Oferta anterior del Fisco: ${session.currentOfferCost.toLocaleString('es-PY')} oro.
Resultado del sistema: ${resultType.toUpperCase()}. Nueva tarifa fijada por el sistema: ${session.currentOfferCost.toLocaleString('es-PY')} oro.
Insolencias acumuladas: ${session.insolenceStrikes}.
Responde como el Gran Canciller del Fisco en consecuencia. Si es REJECTED_LOW, regáñalo duramente por deshonestidad y notifícale el aumento del costo. Si es NEGOCIATING o ACCEPTED, fija la nueva tarifa de ${session.currentOfferCost.toLocaleString('es-PY')} oro.`;

  appendNegotiationHistory(player.id, 'user', userQuery);

  try {
    const aiResponse = await askKingdoomAI(
      session.conversationHistory,
      promptCtx,
      { temperature: 0.6 }
    );

    appendNegotiationHistory(player.id, 'assistant', aiResponse);

    return heraldCard(`🏛️ Real Cancillería: Contraoferta`, [
      aiResponse,
      '\n──────────────',
      `📜 *Mejora:* ${session.labelType} ➔ *${session.newValue.toLocaleString('es-PY')}*`,
      `💰 *Tarifa Actualizada:* 🪙 *${session.currentOfferCost.toLocaleString('es-PY')} oro*`,
      '\n💡 _Responde con `!aceptartrato`, `!contraofertar <monto>` o `!cancelartrato`._'
    ], { icon: '⚖️' });
  } catch (err) {
    console.error('[handleContraofertar AI Error]', err);
    return heraldCard(`🏛️ Real Cancillería: Contraoferta`, [
      ` El Gran Canciller evalúa tu propuesta de 🪙 *${offeredCost.toLocaleString('es-PY')} oro*.`,
      ` Tras revisar los costos mínimos, la Real Cancillería fija la oferta en 🪙 *${session.currentOfferCost.toLocaleString('es-PY')} oro*.`,
      '\n💡 _Escribe `!aceptartrato` para sellar el decreto o `!cancelartrato` para salir._'
    ], { icon: '⚖️' });
  }
}

// 3. Comando !aceptartrato / !aceptarnegociacion
export async function handleAceptarTrato(msg, player) {
  const session = getActiveNegotiation(player.id);
  if (!session) {
    return `❌ No tienes ninguna propuesta ni negociación activa para aceptar.`;
  }

  // Verificar oro del jugador
  const freshPlayer = await getPlayer(player.id);
  const currentGold = freshPlayer ? freshPlayer.gold : player.gold;

  if (currentGold < session.currentOfferCost) {
    return `❌ *Fondos insuficientes.* Tu bolsa actual posee 🪙 *${currentGold.toLocaleString('es-PY')} oro*, pero el contrato exige 🪙 *${session.currentOfferCost.toLocaleString('es-PY')} oro*.`;
  }

  // Ejecutar RPC atómico en Supabase
  try {
    const result = await upgradePlayerBusinessInDb(
      session.businessId,
      player.id,
      session.upgradeType,
      session.newValue,
      session.currentOfferCost
    );

    if (!result.success) {
      return `❌ ${result.message}`;
    }

    clearActiveNegotiation(player.id);

    return heraldCard('🏗️ Ampliación Certificada por la Corona', [
      heraldStat('Negocio', `*${session.businessName}* (Nivel ${result.new_level})`),
      heraldStat('Nueva ' + session.labelType, `*${result.new_value.toLocaleString('es-PY')}*`),
      heraldStat('Inversión Realizada', `🪙 *-${session.currentOfferCost.toLocaleString('es-PY')} oro*`),
      heraldStat('Nuevo Saldo en Bolsa', `🪙 *${result.new_gold.toLocaleString('es-PY')} oro*`),
      '\n ¡El Real Fisco ha emitido el decreto y los maestros albañiles han completado la obra!'
    ], { icon: '📜' });
  } catch (err) {
    console.error('[handleAceptarTrato Error]', err);
    return `❌ Ocurrió un error al procesar el contrato en el servidor. Inténtalo de nuevo.`;
  }
}

// 4. Comando !cancelartrato / !rechazartrato
export async function handleCancelarTrato(msg, player) {
  const session = getActiveNegotiation(player.id);
  if (!session) {
    return `❌ No tienes ninguna negociación de negocio activa que cancelar.`;
  }

  clearActiveNegotiation(player.id);
  return heraldCard('🏛️ Real Cancillería', [
    ` La negociación para la ampliación de *${session.businessName}* ha sido cancelada sin costo.`,
    ' El Gran Canciller archiva los planos de obra.'
  ], { icon: '🚪' });
}
