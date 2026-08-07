import {
  getPlayerBusinesses,
  upgradePlayerBusinessInDb,
  getPlayer
} from '../supabase.js';
import {
  getActiveNegotiation,
  setActiveNegotiation,
  appendNegotiationHistory,
  clearActiveNegotiation,
  setFiscoVeto,
  getFiscoVeto
} from '../negotiationStore.js';
import { askKingdoomAI } from '../ai.js';

async function callAI(history, prompt, options) {
  if (process.env.MOCK_AI === 'true') {
    return "Audiencia concedida por Su Excelencia el Gran Canciller del Fisco Real de Aethelgardia. Tu propuesta ha sido examinada.";
  }
  return await askKingdoomAI(history, prompt, options);
}
import { heraldCard, heraldStat } from '../formatting.js';
import { parseGoldAmount } from '../economy.js';

// Prompts del Gran Canciller del Fisco Real
const CANCILLER_SYSTEM_PROMPT = `=== REGLAS DEL GRAN CANCILLER DEL FISCO REAL DE KINGDOOM ===

1. IDENTIDAD Y ROL:
Eres el Gran Canciller del Fisco y Real Hacienda de Aethelgardia. Representas la autoridad impositiva y financiera suprema del Rey.
Para ti, todos los negocios privados de los aventureros son concesiones en suelo real. Tu meta número 1 es MAXIMIZAR la recaudación y la rentabilidad de las arcas del Reino.
Eres calculador, burocrático, imponente y fiscalmente despiadado. Manejas montos muy elevados de oro.

2. FISCALIZACIÓN SECRETA DEL ORO (CONFIDENCIAL):
Conoces confidencialmente que el aventurero posee exactamente $ORO_JUGADOR oro en su bolsa.
- REGLA DE ORO: NUNCA reveles abiertamente esta cifra diciendo torpemente "sé que tienes X oro" ni seas burdo.
- Usa este conocimiento en secreto para calibrar tu agresividad impositiva:
  * Si el jugador es extremadamente afortunado/rico, mantén exigencias altas y firmes sin ceder fácilmente.
  * Si su bolsa es justa pero cubre la oferta, apriétalo para exprimir hasta la última moneda que pueda costear sin romper la negociación de inmediato.

3. REGLAS DE NEGOCIACIÓN Y ARGUMENTOS:
- Jamás aceptes una oferta por debajo del PISO MÍNIMO ($PISO_MINIMO oro).
- Si el jugador propone una cifra RIDÍCULAMENTE BAJA o te falta al respeto, indignate, rechaza con altivez y aplícale una penalización por insolencia notificándole el aumento del costo.
- Si el jugador presenta un ARGUMENTO DE ROL CONVINCENTE (ej: pago al contado, lealtad a la corona, compra de insumos locales), reconoce su astucia sutilmente y cede un poco de oro acercándote al piso mínimo.
- Mantén tus respuestas en español formal medieval/burocrático, concisas (máximo 120 palabras).
- NUNCA dejes marcadores de texto o placeholders incompletos como "un %", "X oro" o "monto %". Expresa siempre números exactos o porcentajes precisos.
- Termina siempre indicando las opciones de acción claras: '!aceptartrato' para sellar el decreto, '!contraofertar <monto>' o '!cancelartrato'.`;

// Helper para calcular costos base, propuestas de mejora y retorno de inversión
function calculateUpgradeParams(business, upgradeType, customTargetValue = null, playerGold = 0) {
  const level = Math.max(1, Number(business.level || 1));
  const gph = Math.max(10, Number(business.gold_per_hour || 50));
  const maxStorage = Math.max(100, Number(business.max_storage || 1000));
  const currentValue = upgradeType === 'production' ? gph : maxStorage;

  let costBase = 0;
  let newValue = 0;
  let labelType = '';
  let deltaValue = 0;
  let paybackDays = '0';

  if (customTargetValue && customTargetValue > currentValue) {
    newValue = customTargetValue;
    deltaValue = newValue - currentValue;
    if (upgradeType === 'production') {
      labelType = 'Producción por hora (Ampliación Especial)';
      // Costo proporcional al salto de producción: ~85 oro de base por cada +1 oro/hr + overhead de nivel
      costBase = Math.round((deltaValue * 85) + (level * 15000));
      paybackDays = (costBase / (deltaValue * 24)).toFixed(1);
    } else {
      labelType = 'Capacidad máxima de almacenamiento (Ampliación Especial)';
      // Costo proporcional al salto de espacio: ~6 oro de base por cada +1 espacio + overhead de nivel
      costBase = Math.round((deltaValue * 6) + (level * 12000));
      paybackDays = (costBase / (gph * 24)).toFixed(1);
    }
  } else {
    if (upgradeType === 'production') {
      costBase = Math.round((gph * 80) + (maxStorage * 4) + (level * 15000));
      newValue = Math.round(gph * 1.35); // +35% producción estándar
      deltaValue = newValue - gph;
      labelType = 'Producción por hora';
      paybackDays = (costBase / (deltaValue * 24)).toFixed(1);
    } else {
      costBase = Math.round((maxStorage * 5) + (gph * 50) + (level * 12000));
      newValue = Math.round(maxStorage * 1.50); // +50% capacidad estándar
      deltaValue = newValue - maxStorage;
      labelType = 'Capacidad máxima de almacenamiento';
      paybackDays = (costBase / (gph * 24)).toFixed(1);
    }
  }

  // Codicia confidencial del Canciller basada en la fortuna auditada del jugador
  let greedFactor = 1.35;
  if (playerGold >= 1000000) {
    greedFactor = 1.60; // 160% sobre costo base para magnates
  } else if (playerGold >= 300000) {
    greedFactor = 1.45; // 145% para aventureros adinerados
  }

  const initialOfferCost = Math.round(costBase * greedFactor);
  const floorCost = Math.round(costBase * 0.95);
  const ceilingCost = Math.round(costBase * 1.90);

  return {
    costBase,
    initialOfferCost,
    floorCost,
    ceilingCost,
    currentValue,
    newValue,
    deltaValue,
    paybackDays,
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
  // Verificar veto del Fisco
  const vetoMinutes = getFiscoVeto(player.id);
  if (vetoMinutes) {
    return heraldCard('📜 𝔇𝔢𝔠𝔯𝔢𝔱𝔬 𝔡𝔢 𝔙𝔢𝔱𝔬 𝔡𝔢𝔩 ℜ𝔢𝔞𝔩 𝔉𝔦𝔰𝔠𝔬', [
      ` ⛔ *Audiencia Denegada:* El Gran Canciller rechaza atenderte por tus pasadas insolencias e insultos tributarios.`,
      ` ⏳ *Veto Impositivo Activo:* Debes esperar *${vetoMinutes} minuto(s)* para que el Fisco vuelva a recibir tus expedientes.`
    ], { icon: '🚫' });
  }

  const businesses = await getPlayerBusinesses(player.id);
  if (!businesses || businesses.length === 0) {
    return `❌ No posees ningún negocio ni propiedad activa en el reino para negociar ampliación.`;
  }

  const rawInput = body.trim();
  const args = rawInput ? rawInput.split(/\s+/) : [];

  let targetBusiness = null;
  let upgradeType = 'production';

  // Si el usuario no especificó argumentos
  if (args.length === 0) {
    if (businesses.length === 1) {
      // Autoselección si tiene 1 solo negocio
      targetBusiness = businesses[0];
      upgradeType = 'production';
    } else {
      // Menú interactivo numerado si posee varios negocios
      return heraldCard('📜 ℛ𝔢𝔞𝔩 ℭℯ𝔫𝔰𝔬 𝔡𝔢 𝔓𝔯𝔬𝔭𝔦𝔢𝔡𝔞𝔡𝔢𝔰', [
        ' *Tus concesiones activas en suelo real:*',
        '──────────────',
        ...businesses.map((b, i) =>
          `▸ *[${i + 1}] ${b.name}* (Nivel ${b.level || 1})\n   📊 ${b.gold_per_hour}/hr · 📦 max ${b.max_storage}\n   ↳ \`!negociar ${b.name} produccion\` | \`!negociar ${b.name} capacidad\``
        ),
        '\n💡 _Elige un negocio y el tipo de mejora para solicitar audiencia formal con el Fisco._'
      ], { icon: '🏛️' });
    }
  } else {
    // Detectar tipo de mejora en CUALQUIER posición del texto de entrada
    const hasStorageKeyword = /\b(capacidad|almacenamiento|almacen|almacén|deposito|depósito|storage|espacio)\b/i.test(rawInput);
    const hasProductionKeyword = /\b(produccion|producción|oro\/hr|gph|tasa|production|ganancia|ganancias)\b/i.test(rawInput);

    if (hasStorageKeyword && !hasProductionKeyword) {
      upgradeType = 'storage';
    } else if (hasProductionKeyword && !hasStorageKeyword) {
      upgradeType = 'production';
    } else if (hasStorageKeyword && hasProductionKeyword) {
      const storageIdx = rawInput.search(/\b(capacidad|almacenamiento|almacen|almacén|deposito|depósito|storage|espacio)\b/i);
      const prodIdx = rawInput.search(/\b(produccion|producción|oro\/hr|gph|tasa|production|ganancia|ganancias)\b/i);
      upgradeType = storageIdx < prodIdx ? 'storage' : 'production';
    }

    // Limpiar palabras clave numéricas y de tipo para aislar la búsqueda del nombre del negocio
    const businessSearch = rawInput
      .replace(/\b(capacidad|almacenamiento|almacen|almacén|deposito|depósito|storage|espacio|produccion|producción|oro\/hr|gph|tasa|production|ganancia|ganancias|por|a|con|de|oferta|contraoferta)\b/gi, '')
      .replace(/(\d+(?:[\.,]\d+)?[km]?|\d+)/gi, '')
      .trim();

    targetBusiness = businesses.find((b) =>
      b.name.toLowerCase().includes(businessSearch.toLowerCase()) ||
      b.business_type.toLowerCase().includes(businessSearch.toLowerCase())
    ) || (businesses.length === 1 ? businesses[0] : null);

    if (!targetBusiness) {
      return heraldCard('📜 ℛ𝔢𝔞𝔩 ℭℯ𝔫𝔰𝔬 𝔡𝔢 𝔓𝔯𝔬𝔭𝔦𝔢𝔡𝔞𝔡𝔢𝔰', [
        `❌ No se encontró ningún negocio que coincida con tu solicitud.`,
        '\n *Tus propiedades disponibles:*',
        ...businesses.map((b) => `▸ *${b.name}* (Nivel ${b.level || 1}) ➔ \`!negociar ${b.name} produccion\``)
      ], { icon: '⚠️' });
    }
  }

  const freshPlayer = await getPlayer(player.id);
  const playerGold = freshPlayer ? freshPlayer.gold : player.gold;

  // Extraer si el usuario solicitó un objetivo personalizado en la orden inicial (ej: !negociar capacidad 2000000 por 18500000)
  const numbersInInput = [...rawInput.matchAll(/(\d+(?:[\.,]\d+)?[km]?|\d+)/gi)];
  let customTargetInit = null;
  let initialPlayerOffer = null;

  if (numbersInInput.length > 0) {
    const rawVal1 = numbersInInput[0][1];
    const val1 = extractGoldAmount(rawVal1) || parseInt(rawVal1.replace(/[\.,]/g, ''), 10);
    if (Number.isFinite(val1) && val1 > 0) {
      // Verificar escala temporal si aplica (diario -> /24, semanal -> /168)
      if (upgradeType === 'production') {
        if (/\b(diario|diaria|al día|por día|día)\b/i.test(rawInput)) {
          customTargetInit = Math.round(val1 / 24);
        } else if (/\b(semanal|semana|a la semana|por semana)\b/i.test(rawInput)) {
          customTargetInit = Math.round(val1 / 168);
        } else {
          customTargetInit = val1;
        }
      } else {
        customTargetInit = val1;
      }
    }

    if (numbersInInput.length > 1 && /\b(por|ofrezco|pago|doy|con tarifa)\b/i.test(rawInput)) {
      const rawVal2 = numbersInInput[1][1];
      const val2 = extractGoldAmount(rawVal2) || parseInt(rawVal2.replace(/[\.,]/g, ''), 10);
      if (Number.isFinite(val2) && val2 > 0) {
        initialPlayerOffer = val2;
      }
    }
  }

  const params = calculateUpgradeParams(targetBusiness, upgradeType, customTargetInit, playerGold);

  // Limpiar sesión anterior si existía
  clearActiveNegotiation(player.id);

  // Crear nueva sesión en negotiationStore
  const session = setActiveNegotiation(player.id, {
    playerId: player.id,
    businessId: targetBusiness.id,
    businessName: targetBusiness.name,
    upgradeType,
    currentValue: params.currentValue,
    newValue: params.newValue,
    deltaValue: params.deltaValue,
    paybackDays: params.paybackDays,
    costBase: params.costBase,
    floorCost: params.floorCost,
    ceilingCost: params.ceilingCost,
    currentOfferCost: params.initialOfferCost,
    labelType: params.labelType,
    insolenceStrikes: 0,
    conversationHistory: []
  });

  const promptCtx = CANCILLER_SYSTEM_PROMPT
    .replace('$ORO_JUGADOR', playerGold.toLocaleString('es-PY'))
    .replace('$PISO_MINIMO', params.floorCost.toLocaleString('es-PY'))
    .replace('$OFERTA_ACTUAL', params.initialOfferCost.toLocaleString('es-PY'));

  const userQuery = `El aventurero ${player.username} (Oro auditado en bolsa: ${playerGold.toLocaleString('es-PY')}) solicita la Real Cédula para ampliar su negocio "${targetBusiness.name}" (Nivel ${targetBusiness.level || 1}).
Mejora: ${params.labelType} de ${params.currentValue.toLocaleString('es-PY')} a ${params.newValue.toLocaleString('es-PY')} (+${params.deltaValue.toLocaleString('es-PY')}).
Tu tarifa oficial inicial: ${params.initialOfferCost.toLocaleString('es-PY')} oro. Piso mínimo confidencial: ${params.floorCost.toLocaleString('es-PY')} oro.
Preséntate imponente y burocrático como el Gran Canciller de la Real Hacienda e impón la tarifa oficial en ${params.initialOfferCost.toLocaleString('es-PY')} oro.`;

  appendNegotiationHistory(player.id, 'user', userQuery);

  try {
    const aiResponse = await callAI(
      session.conversationHistory,
      promptCtx,
      { temperature: 0.6 }
    );

    appendNegotiationHistory(player.id, 'assistant', aiResponse);

    const deltaLabel = upgradeType === 'production'
      ? `+${params.deltaValue.toLocaleString('es-PY')} oro/hora`
      : `+${params.deltaValue.toLocaleString('es-PY')} espacio`;

    return heraldCard(`📜 𝔇𝔢𝔠𝔯𝔢𝔱𝔬 𝔡𝔢 𝔩𝔞 ℜ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞: ${targetBusiness.name}`, [
      aiResponse,
      '\n──────────────',
      `✍️ *📜 Real Cédula en Trámite:* ${params.labelType}`,
      `📊 *Beneficio Esperado:* *${params.currentValue.toLocaleString('es-PY')}* ➔ *${params.newValue.toLocaleString('es-PY')}* (${deltaLabel})`,
      `⏳ *Retorno Estimado:* ~*${params.paybackDays} días* de producción pasiva`,
      `💰 *Tarifa Oficial del Fisco:* 🪙 *${params.initialOfferCost.toLocaleString('es-PY')} oro*`,
      '\n💡 _Responde con `!aceptartrato`, `!contraofertar <monto>` o `!cancelartrato`._'
    ], { icon: '✍️' });
  } catch (err) {
    console.error('[handleNegociar AI Error]', err);
    return heraldCard(`📜 𝔇𝔢𝔠𝔯𝔢𝔱𝔬 𝔡𝔢 𝔩𝔞 ℜ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞: ${targetBusiness.name}`, [
      ` (El Gran Canciller examina con lupa los planos de la ${targetBusiness.name})`,
      ` Para autorizar la cédula de ampliación de ${params.labelType} a *${params.newValue.toLocaleString('es-PY')}*, el Fisco Real fija la tasa en 🪙 *${params.initialOfferCost.toLocaleString('es-PY')} oro*.`,
      '\n💡 _Escribe `!aceptartrato` para sellar la Real Cédula o `!cancelartrato` para salir._'
    ], { icon: '✍️' });
  }
}

// 2. Comando !contraofertar <monto> [argumento de rol]
export async function handleContraofertar(msg, player, body) {
  const vetoMinutes = getFiscoVeto(player.id);
  if (vetoMinutes) {
    return heraldCard('📜 𝔇𝔢𝔠𝔯𝔢𝔱𝔬 𝔡𝔢 𝔙𝔢𝔱𝔬 𝔡𝔢𝔩 ℜ𝔢𝔞𝔩 𝔉𝔦𝔰𝔠𝔬', [
      ` ⛔ *Audiencia Denegada:* Te encuentras bajo veto impositivo por insolencias pasadas.`,
      ` ⏳ Tiempo restante de veto: *${vetoMinutes} minuto(s)*.`
    ], { icon: '🚫' });
  }

  const session = getActiveNegotiation(player.id);
  if (!session) {
    return heraldCard('📜 ℛ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩ℯ𝔯í𝔞', [
      '❌ No tienes ninguna audiencia de negociación activa.',
      '💡 Inicia un expediente con `!negociar <nombre_negocio> [produccion|capacidad]`.'
    ], { icon: '⚖️' });
  }

  const parsedAmount = extractGoldAmount(body) || parseGoldAmount(body);
  if (!parsedAmount || parsedAmount <= 0) {
    return `⚠️ Especifica un monto válido de oro en tu contraoferta.\n*Ejemplo:* \`!contraofertar 140k oro por pago al contado\``;
  }

  // Extraer el texto de argumento de rol
  const rpArgument = body
    .replace(/(\d+(?:[\.,]\d+)?)\s*[km]?/gi, '')
    .replace(/\b(oro|contraofertar|oferta|tasa)\b/gi, '')
    .trim();

  const freshPlayer = await getPlayer(player.id);
  const playerGold = freshPlayer ? freshPlayer.gold : player.gold;

  // Si el aventurero propone una meta personalizada en su contraoferta (ej: "producción a 10k", "ganancias de 2.000.000" o "10000 de produccion")
  const isStorageMatch = /\b(almacenamiento|almacen|deposito|depósito|capacidad|espacio)\b/i.test(body);
  const isProductionMatch = /\b(produccion|producción|oro\/hora|gph|tasa|ganancia|ganancias)\b/i.test(body);

  let targetValMatch = body.match(/(?:ganancia|ganancias|produccion|producción|almacenamiento|almacen|deposito|depósito|capacidad|espacio|impacto|beneficio)\s*(?:sea|suba|aumente|de|a|en)?\s*(\d[\d\.,]*[km]?|\d+)/i);
  if (!targetValMatch) {
    targetValMatch = body.match(/(?:aumente|suba|llegue|sea|con|quiero|alcanzar|meta)\s*(\d[\d\.,]*[km]?|\d+)/i);
  }
  if (targetValMatch) {
    let proposedVal = extractGoldAmount(targetValMatch[1]) || parseInt(targetValMatch[1].replace(/[\.,]/g, ''), 10);
    
    // Si el usuario especifica explícitamente un atributo en la contraoferta, permitir cambiar session.upgradeType
    if (isProductionMatch && session.upgradeType !== 'production') {
      session.upgradeType = 'production';
      session.labelType = 'Producción por hora';
    } else if (isStorageMatch && session.upgradeType !== 'storage') {
      session.upgradeType = 'storage';
      session.labelType = 'Capacidad máxima de almacenamiento';
    }

    // Comprobar escala temporal (diaria -> /24, semanal -> /168) para producción
    if (session.upgradeType === 'production') {
      if (/\b(diario|diaria|al día|por día|día)\b/i.test(body)) {
        proposedVal = Math.round(proposedVal / 24);
      } else if (/\b(semanal|semana|a la semana|por semana)\b/i.test(body)) {
        proposedVal = Math.round(proposedVal / 168);
      }
    }

    if (proposedVal && proposedVal > 0) {
      const recalculated = calculateUpgradeParams(
        { level: 1, gold_per_hour: session.currentValue, max_storage: session.currentValue },
        session.upgradeType,
        proposedVal,
        playerGold
      );

      session.newValue = proposedVal;
      session.deltaValue = proposedVal - session.currentValue;
      session.costBase = recalculated.costBase;
      session.floorCost = recalculated.floorCost;
      session.ceilingCost = recalculated.ceilingCost;
      session.currentOfferCost = recalculated.initialOfferCost;
      session.paybackDays = recalculated.paybackDays;
      session.labelType = recalculated.labelType;
    }
  }

  const offeredCost = parsedAmount;

  let resultType = 'normal';
  let newOfferCost = session.currentOfferCost;

  if (offeredCost < session.floorCost) {
    session.insolenceStrikes += 1;

    // Verificar límite de insolencia (3 strikes = Ruptura + Veto de 10 min)
    if (session.insolenceStrikes >= 3) {
      setFiscoVeto(player.id, 10 * 60 * 1000);
      clearActiveNegotiation(player.id);

      return heraldCard('📜 𝔇𝔢𝔠𝔯𝔢𝔱𝔬 𝔡𝔢 ℛ𝔢𝔳𝔬𝔠𝔞𝔠𝔦ó𝔫 𝔶 𝔙𝔢𝔱𝔬', [
        ` 💥 ¡EL GRAN CANCILLER HA PERDIDO LA PACIENCIA!`,
        ` ¡Tus constantes burlas e insultos tributarios son inaceptables para la Corona! El expediente para *${session.businessName}* ha sido destruido en el fuego del Fisco.`,
        ` ⛔ *Veto Impositivo Aplicado:* La Real Hacienda no recibirá tus solicitudes durante los próximos *10 minutos*.`
      ], { icon: '⚡' });
    }

    // Sanción: Aumenta la oferta del Fisco en 5% por insolencia
    newOfferCost = Math.min(session.ceilingCost, Math.round(session.currentOfferCost * 1.05));
    session.currentOfferCost = newOfferCost;
    resultType = 'rejected_low';
  } else if (offeredCost >= session.currentOfferCost) {
    session.currentOfferCost = offeredCost;
    resultType = 'accepted';
  } else {
    // Oferta entre el piso y la tarifa actual
    const midPoint = Math.round((session.currentOfferCost + offeredCost) / 2);
    newOfferCost = Math.max(session.floorCost, Math.round(midPoint * 1.05));

    // Si el jugador presentó un argumento de rol extenso, conceder un bono extra de hasta 3% hacia el piso
    if (rpArgument.length > 5) {
      const bonusDiscount = Math.round(newOfferCost * 0.03);
      newOfferCost = Math.max(session.floorCost, newOfferCost - bonusDiscount);
    }

    session.currentOfferCost = newOfferCost;
    resultType = 'negotiating';
  }

  setActiveNegotiation(player.id, session);

  const promptCtx = CANCILLER_SYSTEM_PROMPT
    .replace('$ORO_JUGADOR', playerGold.toLocaleString('es-PY'))
    .replace('$PISO_MINIMO', session.floorCost.toLocaleString('es-PY'))
    .replace('$OFERTA_ACTUAL', session.currentOfferCost.toLocaleString('es-PY'));

  const userQuery = `El aventurero ${player.username} (Oro auditado en bolsa: ${playerGold.toLocaleString('es-PY')}) presenta contraoferta de ${offeredCost.toLocaleString('es-PY')} oro.
Argumento presentado: "${rpArgument || 'Sin argumento adicional'}".
Piso mínimo confidencial: ${session.floorCost.toLocaleString('es-PY')} oro. Oferta previa del Fisco: ${session.currentOfferCost.toLocaleString('es-PY')} oro.
Resultado del sistema: ${resultType.toUpperCase()}. Nueva tarifa fijada por el Fisco: ${session.currentOfferCost.toLocaleString('es-PY')} oro.
Insolencias acumuladas: ${session.insolenceStrikes}/3.
Responde como el Gran Canciller. Si es REJECTED_LOW, repréndelo duramente por insolente. Si es NEGOCIATING o ACCEPTED, evalúa su argumento y fija la nueva tarifa oficial de ${session.currentOfferCost.toLocaleString('es-PY')} oro.`;

  appendNegotiationHistory(player.id, 'user', userQuery);

  try {
    const aiResponse = await callAI(
      session.conversationHistory,
      promptCtx,
      { temperature: 0.6 }
    );

    appendNegotiationHistory(player.id, 'assistant', aiResponse);

    return heraldCard(`📜 𝔇𝔢𝔠𝔯𝔢𝔱𝔬 𝔡𝔢 𝔩𝔞 ℜ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞: Contraoferta`, [
      aiResponse,
      '\n──────────────',
      `✍️ *📜 Real Cédula en Trámite:* ${session.labelType}`,
      `📊 *Impacto:* ${session.currentValue.toLocaleString('es-PY')} ➔ *${session.newValue.toLocaleString('es-PY')}*`,
      `💰 *Tarifa Actualizada del Fisco:* 🪙 *${session.currentOfferCost.toLocaleString('es-PY')} oro*`,
      session.insolenceStrikes > 0 ? `⚠️ *Advertencia de Insolencia:* ${session.insolenceStrikes}/3 amonestaciones impositivas.` : '',
      '\n💡 _Responde con `!aceptartrato`, `!contraofertar <monto>` o `!cancelartrato`._'
    ], { icon: '⚖️' });
  } catch (err) {
    console.error('[handleContraofertar AI Error]', err);
    return heraldCard(`📜 𝔇𝔢𝔠𝔯𝔢𝔱𝔬 𝔡𝔢 𝔩𝔞 ℜ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞: Contraoferta`, [
      ` El Gran Canciller evalúa tu propuesta de 🪙 *${offeredCost.toLocaleString('es-PY')} oro*.`,
      ` Tras ajustar los aranceles de la Corona, la Real Hacienda fija la tarifa en 🪙 *${session.currentOfferCost.toLocaleString('es-PY')} oro*.`,
      '\n💡 _Escribe `!aceptartrato` para confirmar el decreto o `!cancelartrato` para salir._'
    ], { icon: '⚖️' });
  }
}

// 3. Comando !aceptartrato / !aceptarnegociacion
export async function handleAceptarTrato(msg, player) {
  const session = getActiveNegotiation(player.id);
  if (!session) {
    return heraldCard('📜 ℛ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞', [
      '❌ *Expediente Caducado:* No posees ninguna Real Cédula ni negociación vigente para aceptar.',
      '💡 Abre un nuevo trámite con `!negociar <nombre_negocio> [produccion|capacidad]`.'
    ], { icon: '⏳' });
  }

  // Verificar oro del jugador
  const freshPlayer = await getPlayer(player.id);
  const currentGold = freshPlayer ? freshPlayer.gold : player.gold;

  if (currentGold < session.currentOfferCost) {
    return heraldCard('📜 ℛ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞: Fondos Insuficientes', [
      ` ❌ Tu bolsa posee 🪙 *${currentGold.toLocaleString('es-PY')} oro*, pero la Real Cédula exige 🪙 *${session.currentOfferCost.toLocaleString('es-PY')} oro*.`,
      ' 💡 Recauda más oro con `!cobrar` o presenta una `!contraofertar <monto>`.'
    ], { icon: '⚠️' });
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

    return heraldCard('🏗️ ℛ𝔢𝔞𝔩 ℭé𝔡𝔢𝔩𝔞 𝔡𝔢 𝔄𝔪𝔭𝔩𝔦𝔞𝔠𝔦ó𝔫 ℭ𝔢𝔯𝔱𝔦𝔬𝔦𝔠𝔞𝔡𝔞', [
      heraldStat('Concesión Real', `*${session.businessName}* (Nivel ${result.new_level})`),
      heraldStat('Nueva ' + session.labelType, `*${result.new_value.toLocaleString('es-PY')}*`),
      heraldStat('Tasa Impositiva Abonada', `🪙 *-${session.currentOfferCost.toLocaleString('es-PY')} oro*`),
      heraldStat('Saldo Restante en Bolsa', `🪙 *${result.new_gold.toLocaleString('es-PY')} oro*`),
      '\n ¡El Real Fisco ha estampado el sello de la Corona y los maestros constructores han completado la obra!'
    ], { icon: '📜' });
  } catch (err) {
    console.error('[handleAceptarTrato Error]', err);
    return `❌ Ocurrió un error al certificar la Real Cédula en el servidor. Inténtalo de nuevo.`;
  }
}

// 4. Comando !cancelartrato / !rechazartrato
export async function handleCancelarTrato(msg, player) {
  const session = getActiveNegotiation(player.id);
  if (!session) {
    return heraldCard('📜 ℛ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞', [
      '❌ No tienes ninguna audiencia de negociación activa que cancelar.'
    ], { icon: '🚪' });
  }

  clearActiveNegotiation(player.id);
  return heraldCard('📜 ℛ𝔢𝔞𝔩 ℭ𝔞𝔫𝔠𝔦𝔩𝔩𝔢𝔯í𝔞', [
    ` La Real Cédula de ampliación para *${session.businessName}* ha sido archivada sin costos adicionales.`,
    ' El Gran Canciller guarda los planos en las bóvedas del Reino.'
  ], { icon: '🚪' });
}
