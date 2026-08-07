import {
  getActiveColosseumMatch,
  createColosseumMatch,
  setColosseumMessageIds,
  findColosseumBetTargetByQuotedId,
  recordColosseumBet,
  closeColosseumBetting,
  recordColosseumRound,
  resolveColosseumWinner,
  cancelColosseumMatch,
} from '../colosseumStore.js';
import { pairColosseumFighters } from '../loreRaces.js';
import { getPlayersByPhone, updateGold } from '../supabase.js';
import { parseGoldAmount } from '../economy.js';
import { decorateCommandReply, heraldCard, heraldStat } from '../formatting.js';
import { askKingdoomAI } from '../ai.js';
import { hasQuotedMessageMetadata } from '../whatsappDelivery.js';
import { safeGetQuotedDetails } from '../targetResolver.js';
import { normalizePhone, formatJid } from '../adminStore.js';

const ROLEPLAY_GROUP_ID = process.env.ROLEPLAY_ACTIVITY_GROUP_ID || '120363024420812768@g.us';
const DEFAULT_BETTING_MINUTES = 3;
const DEFAULT_COMBAT_INTERVAL_MS = Math.max(
  1000,
  Number.parseInt(process.env.COLOSSEUM_COMBAT_INTERVAL_MS ?? '60000', 10) || 60000
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatGold(val) {
  return Number(val ?? 0).toLocaleString('es-PY');
}

function renderHpBar(current, max) {
  const safeCurrent = Math.max(0, current);
  const percent = Math.max(0, Math.min(10, Math.round((safeCurrent / max) * 10)));
  const filled = '█'.repeat(percent);
  const empty = '░'.repeat(10 - percent);
  return `[${filled}${empty}] ${safeCurrent}/${max} HP`;
}

export async function handleColiseo(msg, client, body = '') {
  const active = getActiveColosseumMatch();
  if (active && (active.status === 'betting' || active.status === 'fighting')) {
    const timeRemainingSec = Math.max(0, Math.round((active.bettingClosesAt - Date.now()) / 1000));
    return heraldCard('Coliseo en curso', [
      active.status === 'betting'
        ? `Las apuestas para el combate entre *${active.fighterA.fullName}* y *${active.fighterB.fullName}* estan abiertas.`
        : `El combate entre *${active.fighterA.fullName}* y *${active.fighterB.fullName}* se esta librando en la Arena.`,
      active.status === 'betting'
        ? heraldStat('Cierre de apuestas en', `${timeRemainingSec} segundos`)
        : heraldStat('Estado', 'Combate a muerte en progreso en el grupo de roleo'),
      heraldStat('Luchador 1 (1)', `${active.fighterA.fullName} · ${active.fighterA.odds}x`),
      heraldStat('Luchador 2 (2)', `${active.fighterB.fullName} · ${active.fighterB.odds}x`),
      'Para apostar, cita la ficha del luchador o escribe: *!apostar <1|2> <monto>*',
    ], { icon: '⚔️' });
  }

  const durationMatch = body.match(/(\d+)\s*(?:min|m|minutos)?/i);
  const minutes = durationMatch ? Math.max(1, Math.min(15, Number.parseInt(durationMatch[1], 10))) : DEFAULT_BETTING_MINUTES;
  const bettingDurationMs = minutes * 60 * 1000;

  const { fighterA, fighterB } = pairColosseumFighters();
  const match = createColosseumMatch({
    fighterA,
    fighterB,
    chatId: msg.from,
    roleplayChatId: ROLEPLAY_GROUP_ID,
    bettingDurationMs,
    combatIntervalMs: DEFAULT_COMBAT_INTERVAL_MS,
  });

  // 1. Mensaje de Apertura
  const announcementText = heraldCard('⚔️ 𝕲𝖗𝖆𝖓 𝕮𝖔𝖑𝖎𝖘𝖊𝖔 𝖉𝖊𝖑 𝕽𝖊𝖎𝖓𝖔 ⚔️', [
    '¡El clarin de la Arena Imperial ha resonado en todo el Reino!',
    `Se abre el duelo entre dos grandes campeones de las razas de Kingdoom.`,
    heraldStat('Luchador A (1)', `${fighterA.fullName} (${fighterA.raceName}) · Cuota ${fighterA.odds}x`),
    heraldStat('Luchador B (2)', `${fighterB.fullName} (${fighterB.raceName}) · Cuota ${fighterB.odds}x`),
    heraldStat('Ventana de Apuestas', `${minutes} minutos`),
    '📌 *Como apostar:* Cita el mensaje de la ficha de tu luchador escribiendo: *!apostar <monto>* (ej. `!apostar 15000` o `!apostar 50k`).',
    'Tambien puedes usar: *!apostar 1 <monto>* o *!apostar 2 <monto>*.',
  ], { icon: '🏛️' });

  // 2. Ficha Técnica de Gladiador A
  const fighterAText = [
    `🗡️ ─── [LUCHADOR A: ${fighterA.fullName.toUpperCase()}] ─── 🗡️`,
    `👑 Nombre: *${fighterA.name}* ${fighterA.epithet}`,
    `🏛️ Raza y Facción: *${fighterA.raceName}* (${fighterA.faction})`,
    `⚖️ Complexión: *${fighterA.height}* · *${fighterA.weight}*`,
    `🛡️ Arma: *${fighterA.weapon}*`,
    `📊 Atributos RPG: FUE ${fighterA.stats.str} | DES ${fighterA.stats.dex} | CON ${fighterA.stats.con} | ARC ${fighterA.stats.arc} | RES ${fighterA.stats.res}`,
    `📈 Métricas de Combate: ${fighterA.metrics.forceKn} kN de impacto · ${fighterA.metrics.speedMs} m/s · ${fighterA.metrics.reactionMs} ms reacción`,
    `🩸 Salud Máxima: *${fighterA.maxHp} HP*`,
    `⚔️ Rasgo Pasivo: ${fighterA.passiveTrait}`,
    `✨ Habilidad Especial: ${fighterA.specialSkill}`,
    `💰 Multiplicador de Ganancia: *${fighterA.odds}x*`,
    `\n👉 *CITA ESTE MENSAJE CON "!apostar <monto>" PARA APOSTAR POR ESTE GLADIADOR*`,
  ].join('\n');

  // 3. Ficha Técnica de Gladiador B
  const fighterBText = [
    `🪓 ─── [LUCHADOR B: ${fighterB.fullName.toUpperCase()}] ─── 🪓`,
    `👑 Nombre: *${fighterB.name}* ${fighterB.epithet}`,
    `🏛️ Raza y Facción: *${fighterB.raceName}* (${fighterB.faction})`,
    `⚖️ Complexión: *${fighterB.height}* · *${fighterB.weight}*`,
    `🛡️ Arma: *${fighterB.weapon}*`,
    `📊 Atributos RPG: FUE ${fighterB.stats.str} | DES ${fighterB.stats.dex} | CON ${fighterB.stats.con} | ARC ${fighterB.stats.arc} | RES ${fighterB.stats.res}`,
    `📈 Métricas de Combate: ${fighterB.metrics.forceKn} kN de impacto · ${fighterB.metrics.speedMs} m/s · ${fighterB.metrics.reactionMs} ms reacción`,
    `🩸 Salud Máxima: *${fighterB.maxHp} HP*`,
    `⚔️ Rasgo Pasivo: ${fighterB.passiveTrait}`,
    `✨ Habilidad Especial: ${fighterB.specialSkill}`,
    `💰 Multiplicador de Ganancia: *${fighterB.odds}x*`,
    `\n👉 *CITA ESTE MENSAJE CON "!apostar <monto>" PARA APOSTAR POR ESTE GLADIADOR*`,
  ].join('\n');

  try {
    const sentAnnouncement = await client.sendMessage(msg.from, announcementText);
    await sleep(400);
    const sentA = await client.sendMessage(msg.from, fighterAText);
    await sleep(400);
    const sentB = await client.sendMessage(msg.from, fighterBText);

    setColosseumMessageIds(match.id, {
      announcementMsgId: sentAnnouncement?.id?._serialized || sentAnnouncement?.id,
      fighterAMsgId: sentA?.id?._serialized || sentA?.id,
      fighterBMsgId: sentB?.id?._serialized || sentB?.id,
    });

    match.timer = setTimeout(() => {
      startColosseumCombat(client, match.id).catch((err) => {
        console.error('[startColosseumCombat.timer]', err);
      });
    }, bettingDurationMs);

    return null;
  } catch (err) {
    console.error('[handleColiseo]', err);
    return announcementText;
  }
}

export async function handleApostarColiseo(msg, client, commandBody = '', options = {}) {
  const match = getActiveColosseumMatch();
  if (!match || match.status !== 'betting') {
    return heraldCard('Apuestas cerradas', [
      'No hay ninguna ventana de apuestas activa en el Coliseo en este momento.',
      'Espera a que un heraldo convoque un nuevo duelo con *!coliseo*.',
    ], { icon: '🔒' });
  }

  let target = options.targetExplicit || null;

  // Check if message is quoting one of the fighter cards
  if (!target && hasQuotedMessageMetadata(msg)) {
    const quoted = await safeGetQuotedDetails(msg);
    if (quoted?.id) {
      target = findColosseumBetTargetByQuotedId(quoted.id);
    }
  }

  // Fallback if user typed "!apostar 1 5000" or "!apostar A 5000" or "!apostar 2 10000"
  let parsedAmount = 0;
  const tokens = commandBody.trim().split(/\s+/).filter(Boolean);

  if (!target && tokens.length >= 2) {
    const firstToken = tokens[0].toLowerCase();
    if (['1', 'a', 'luchador1', 'luchadora'].includes(firstToken)) {
      target = 'A';
      parsedAmount = parseGoldAmount(tokens.slice(1).join(' '));
    } else if (['2', 'b', 'luchador2', 'luchadorb'].includes(firstToken)) {
      target = 'B';
      parsedAmount = parseGoldAmount(tokens.slice(1).join(' '));
    }
  }

  if (!parsedAmount) {
    parsedAmount = parseGoldAmount(commandBody);
  }

  if (!target) {
    return heraldCard('Selecciona tu gladiador', [
      'Para apostar, debes citar el mensaje del luchador o indicar su número:',
      heraldStat('Opción 1', `${match.fighterA.fullName} (Cuota ${match.fighterA.odds}x)`),
      heraldStat('Opción 2', `${match.fighterB.fullName} (Cuota ${match.fighterB.odds}x)`),
      'Ejemplo: *!apostar 1 10000* o responde a la tarjeta de tu luchador con *!apostar 10000*',
    ], { icon: '🎯' });
  }

  if (!parsedAmount || parsedAmount <= 0) {
    return heraldCard('Monto no válido', [
      'Debes ingresar una cantidad válida de oro para apostar en el Coliseo.',
      'Ejemplos válidos: *!apostar 5000*, *!apostar 25k*, *!apostar 100.000*',
    ], { icon: '⚠️' });
  }

  const sender = msg.author || msg.from;
  const players = await getPlayersByPhone(sender);
  const player = players[0];

  if (!player) {
    return heraldCard('Sin cuenta de juego', [
      'No se encontró una cuenta de aventurero vinculada a este número de WhatsApp.',
      'Regístrate en la web oficial para participar en las apuestas del Reino.',
    ], { icon: '❌' });
  }

  const currentGold = Number(player.gold ?? 0);
  if (currentGold < parsedAmount) {
    return heraldCard('Oro insuficiente', [
      `No posees suficiente oro en tu bolsa para cubrir esta apuesta.`,
      heraldStat('Saldo actual', `${formatGold(currentGold)} oro`),
      heraldStat('Monto requerido', `${formatGold(parsedAmount)} oro`),
    ], { icon: '💰' });
  }

  // Deduct bet gold atomically
  try {
    await updateGold(player.id, -parsedAmount, {
      action: 'colosseum_bet',
      matchId: match.id,
      target,
    });
  } catch (err) {
    console.error('[handleApostarColiseo.updateGold]', err);
    return heraldCard('Error en la bolsa', [
      'No se pudo registrar la deducción de tu oro. Intenta de nuevo en unos momentos.',
    ], { icon: '⚠️' });
  }

  let recordedBet;
  try {
    recordedBet = recordColosseumBet(match, {
      playerPhone: sender,
      username: player.username,
      target,
      amount: parsedAmount,
    });
  } catch (err) {
    // Refund if bet recording failed
    await updateGold(player.id, parsedAmount, { action: 'colosseum_refund' }).catch(() => null);
    return heraldCard('Apuesta no válida', [err.message], { icon: '⛔' });
  }

  const chosenFighter = target === 'A' ? match.fighterA : match.fighterB;
  return heraldCard('📜 𝕬𝖕𝖚𝖊𝖘𝖙𝖆 𝕬𝖘𝖊𝖌𝖚𝖗𝖆𝖉𝖆 𝖊𝖓 𝖊𝖑 𝕮𝖔𝖑𝖎𝖘𝖊𝖔', [
    `El escribano del Fisco Real ha registrado tu apuesta para el gran combate.`,
    heraldStat('Apostador', player.username),
    heraldStat('Gladiador Elegido', chosenFighter.fullName),
    heraldStat('Raza', chosenFighter.raceName),
    heraldStat('Monto Apostado', `${formatGold(recordedBet.amount)} oro`),
    heraldStat('Multiplicador', `${recordedBet.odds}x`),
    heraldStat('Ganancia Potencial', `+${formatGold(recordedBet.potentialPayout)} oro`),
    heraldStat('Oro restante', `${formatGold(currentGold - parsedAmount)} oro`),
  ], { icon: '🎟️' });
}

export async function startColosseumCombat(client, matchId) {
  const active = getActiveColosseumMatch();
  if (!active || active.id !== matchId || active.status !== 'betting') {
    return;
  }

  closeColosseumBetting(active);

  // 1. Anuncio de Cierre en Grupo Principal
  const totalWagered = active.bets.reduce((sum, b) => sum + b.amount, 0);
  const closingText = heraldCard('⏳ ¡Apuestas Cerradas en el Coliseo!', [
    `La ventana de apuestas ha concluido. El combate se traslada a la Arena oficial.`,
    heraldStat('Total en juego', `${formatGold(totalWagered)} oro`),
    heraldStat('Total de apostadores', `${active.bets.length} participantes`),
    heraldStat('Gladiador A', `${active.fighterA.fullName} (${active.fighterA.odds}x)`),
    heraldStat('Gladiador B', `${active.fighterB.fullName} (${active.fighterB.odds}x)`),
    `Sigue el combate en vivo asalto por asalto en el grupo de roleo: \`${active.roleplayChatId}\``,
  ], { icon: '🛡️' });

  await client.sendMessage(active.chatId, closingText).catch(() => null);

  // 2. Inicio del Combate en Grupo de Roleo
  const introArenaText = [
    `⚔️ ─── 𝕰𝕷 𝕮𝕺𝕷𝕴𝕾𝕰𝕺 𝕯𝕰 𝕷𝕬𝕾 𝕽𝕬𝖅𝕬𝕾 𝕳𝕬 𝕮𝕺𝕸𝕰𝕹𝖅𝕬𝕯𝕺 ─── ⚔️`,
    `Las puertas de hierro forjado se abren con estruendo sobre las arenas doradas.`,
    `En la esquina norte: *${active.fighterA.fullName}* empuñando *${active.fighterA.weapon}*.`,
    `En la esquina sur: *${active.fighterB.fullName}* empuñando *${active.fighterB.weapon}*.`,
    `\n*¡Los contendientes lucharán hasta que uno caiga a 0 HP!*`,
  ].join('\n');

  let lastSentMsg = await client.sendMessage(active.roleplayChatId, introArenaText).catch(() => null);

  // Combat simulation loop until one falls to 0 HP
  let roundNum = 1;
  const fA = active.fighterA;
  const fB = active.fighterB;

  while (fA.currentHp > 0 && fB.currentHp > 0) {
    await sleep(active.combatIntervalMs);

    // Determine attacker & defender for this exchange (alternate initiative)
    const isATurn = roundNum % 2 !== 0;
    const attacker = isATurn ? fA : fB;
    const defender = isATurn ? fB : fA;

    // Generate dynamic martial roleplay narrative with AI or built-in procedural engine
    const combatNarrative = await generateCombatExchange(attacker, defender, roundNum);

    // Message 1: Attacker Roleplay
    const attackText = `⚔️ [ASALTO ${roundNum} · ${attacker.name.toUpperCase()}]\n${combatNarrative.attack}`;
    const sentAttackMsg = await client.sendMessage(active.roleplayChatId, attackText).catch(() => null);

    await sleep(Math.min(3000, active.combatIntervalMs / 10));

    // Message 2: Defender Reaction (as a quoted response if message ID available)
    const defendText = `🛡️ [REACCIÓN · ${defender.name.toUpperCase()}]\n${combatNarrative.defense}`;
    if (sentAttackMsg?.id?._serialized) {
      await client.sendMessage(active.roleplayChatId, defendText, {
        quotedMessageId: sentAttackMsg.id._serialized,
      }).catch(() => client.sendMessage(active.roleplayChatId, defendText));
    } else {
      await client.sendMessage(active.roleplayChatId, defendText).catch(() => null);
    }

    // Apply calculated damage & update stats
    const damageDealt = combatNarrative.damage;
    defender.currentHp = Math.max(0, defender.currentHp - damageDealt);

    if (combatNarrative.buff) attacker.buffs.push(combatNarrative.buff);
    if (combatNarrative.nerf) defender.nerfs.push(combatNarrative.nerf);

    recordColosseumRound(active, {
      attacker: attacker.name,
      defender: defender.name,
      damage: damageDealt,
      attackerHp: attacker.currentHp,
      defenderHp: defender.currentHp,
      narrative: combatNarrative,
    });

    await sleep(Math.min(2000, active.combatIntervalMs / 15));

    // Message 3: RPG Combat Status Card
    const statusCard = [
      `🩸 ─── 𝕰𝖘𝖙𝖆𝖉𝖔 𝖙𝖗𝖆𝖘 𝖊𝖑 𝕬𝖘𝖆𝖑𝖙𝖔 ${roundNum} ─── 🩸`,
      `🗡️ *${fA.name}:* ${renderHpBar(fA.currentHp, fA.maxHp)}`,
      `🪓 *${fB.name}:* ${renderHpBar(fB.currentHp, fB.maxHp)}`,
      combatNarrative.tacticalSituation ? `⚡ *Situación:* ${combatNarrative.tacticalSituation}` : '',
      defender.currentHp <= 0 ? `💀 *¡${defender.fullName} ha caído fulminado en la arena!*` : '',
    ].filter(Boolean).join('\n');

    await client.sendMessage(active.roleplayChatId, statusCard).catch(() => null);

    if (defender.currentHp <= 0) {
      break;
    }

    roundNum += 1;
  }

  // Determine Winner
  const winnerKey = fA.currentHp > 0 ? 'A' : 'B';
  const winnerFighter = winnerKey === 'A' ? fA : fB;
  const loserFighter = winnerKey === 'A' ? fB : fA;

  // 4. Declaración Final en Grupo de Roleo
  const victoryRoleplayText = [
    `👑 ─── 𝕱𝕴𝕹𝕬𝕷 𝕯𝕰𝕷 𝕮𝕺𝕸𝕭𝕬𝕔𝕰 · 𝕍𝕴𝕮𝕿𝕺𝕽𝕴𝕬 ─── 👑`,
    `Con un golpe final demoledor, *${winnerFighter.fullName}* alza su arma ensangrentada hacia el palco de la corte.`,
    `*${loserFighter.fullName}* yace derrotado en las arenas del Coliseo tras una resistencia feroz.`,
    `\n🏆 *¡${winnerFighter.fullName} es coronado Campeón de la Arena Imperial!*`,
  ].join('\n');

  await client.sendMessage(active.roleplayChatId, victoryRoleplayText).catch(() => null);

  // 5. Liquidación de Pagos en Supabase
  const settlement = resolveColosseumWinner(active, winnerKey);

  for (const winBet of settlement.winners) {
    const players = await getPlayersByPhone(winBet.playerPhone);
    const p = players[0];
    if (p) {
      await updateGold(p.id, winBet.potentialPayout, {
        action: 'colosseum_payout',
        matchId: active.id,
        winner: winnerKey,
      }).catch((e) => console.error('[colosseum payout error]', e));
    }
  }

  // 6. Publicación del Decreto de Ganadores en Grupo Principal
  const winnersList = settlement.winners.length > 0
    ? settlement.winners.map((w) => `• *${w.username}*: +${formatGold(w.potentialPayout)} oro (apostó ${formatGold(w.amount)})`).join('\n')
    : 'Nadie apostó por el vencedor en este duelo.';

  const decreeText = heraldCard('🏆 𝕯𝖊𝖈𝖗𝖊𝖙𝖔 𝖉𝖊 𝖁𝖎𝖈𝖙𝖔𝖗𝖎𝖆 𝖉𝖊𝖑 𝕮𝖔𝖑𝖎𝖘𝖊𝖔', [
    `El duelo en la Arena ha concluido con la victoria indiscutible de:`,
    heraldStat('Gladiador Vencedor', `${winnerFighter.fullName} (${winnerFighter.raceName})`),
    heraldStat('Cuota Pagada', `${winnerFighter.odds}x`),
    heraldStat('Total de Oro Repartido', `${formatGold(settlement.totalDistributedGold)} oro`),
    heraldStat('Apostadores Ganadores', `${settlement.winnersCount}`),
    `\n📜 *Lista de Ganadores Acreditados:*\n${winnersList}`,
  ], { icon: '👑' });

  await client.sendMessage(active.chatId, decreeText).catch(() => null);
}

async function generateCombatExchange(attacker, defender, roundNum) {
  const prompt = `Simula el Asalto ${roundNum} de un combate de gladiadores en un coliseo de fantasía medieval oscura (universo Kingdoom).
Atacante: ${attacker.fullName} | Raza: ${attacker.raceName} (${attacker.faction}) | Arma: ${attacker.weapon} | FUE: ${attacker.stats.str}, DES: ${attacker.stats.dex}, Impacto: ${attacker.metrics.forceKn} kN, Rasgo: ${attacker.passiveTrait}, Habilidad: ${attacker.specialSkill}.
Defensor: ${defender.fullName} | Raza: ${defender.raceName} (${defender.faction}) | Arma: ${defender.weapon} | CON: ${defender.stats.con}, RES: ${defender.stats.res}, Velocidad: ${defender.metrics.speedMs} m/s, Reacción: ${defender.metrics.reactionMs} ms, Rasgo: ${defender.passiveTrait}.

Genera un JSON con exactamente este formato:
{
  "attack": "Texto de 2 a 3 líneas del atacante ejecutando su golpe o habilidad especial con prosa marcial inmersiva.",
  "defense": "Texto de 2 a 3 líneas del defensor reaccionando, bloqueando o recibiendo el impacto.",
  "damage": número entero de daño entre 15 y 45,
  "buff": "Buff ganado por el atacante (ej. 'Postura Firme', 'Sed de Sangre') o null",
  "nerf": "Herida sufrida por el defensor (ej. 'Hombro Luxado', 'Corte en Muslo') o null",
  "tacticalSituation": "Frase corta del estado en la arena"
}`;

  try {
    const rawAiResponse = await askKingdoomAI([], prompt, {
      maxOutputTokens: 500,
      temperature: 0.8,
    });

    const jsonMatch = rawAiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        attack: parsed.attack || `${attacker.name} avanza con paso pesado y descarga un tajo frontal con su ${attacker.weapon}.`,
        defense: parsed.defense || `${defender.name} interpone su guardia pero el impacto de ${attacker.metrics.forceKn} kN lo hace retroceder tambaleante.`,
        damage: Number.isFinite(parsed.damage) ? Math.max(12, Math.min(50, parsed.damage)) : 25,
        buff: parsed.buff || null,
        nerf: parsed.nerf || null,
        tacticalSituation: parsed.tacticalSituation || 'El público ruge ante el choque de metal y sangre.',
      };
    }
  } catch (err) {
    console.warn('[generateCombatExchange.ai] Fallback procedural:', err.message);
  }

  // High-fidelity procedural fallback
  const baseDmg = Math.round(18 + (attacker.stats.str * 2.2) + (attacker.weaponBonusAtk) - (defender.stats.con * 1.1));
  const finalDmg = Math.max(15, Math.min(45, baseDmg + Math.floor(Math.random() * 8)));

  return {
    attack: `${attacker.name} canaliza la fuerza de su raza (${attacker.raceName}), cargando a ${attacker.metrics.speedMs} m/s para descargar un impacto masivo con su ${attacker.weapon}.`,
    defense: `${defender.name} intenta desviar la embestida con ${defender.metrics.reactionMs} ms de reacción, pero la potencia de ${attacker.metrics.forceKn} kN quiebra parte de su postura defensiva.`,
    damage: finalDmg,
    buff: roundNum === 2 ? 'Impulso de Gladiador' : null,
    nerf: finalDmg > 28 ? 'Herida Abierta (-2 Agilidad)' : null,
    tacticalSituation: `${attacker.name} presiona implacablemente en el centro del foso de arena.`,
  };
}
