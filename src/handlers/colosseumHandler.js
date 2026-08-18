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

function formatSkillOrTrait(text) {
  if (!text) return '';
  const colonIndex = text.indexOf(':');
  if (colonIndex !== -1) {
    const title = text.slice(0, colonIndex).trim();
    const desc = text.slice(colonIndex + 1).trim();
    return `*${title}*\n${desc}`;
  }
  const parenMatch = text.match(/^([^(]+)\(([^)]+)\)\.?$/);
  if (parenMatch) {
    const title = parenMatch[1].trim();
    let desc = parenMatch[2].trim();
    desc = desc.replace(/,\s*/g, ' → ');
    return `*${title}*\n${desc}`;
  }
  return text;
}

function formatFighterCard(fighter, label, icon) {
  const border = `${icon}━━━━━━━━━━━━━━━━${icon}`;
  const rawEpithet = (fighter.epithet || '').replace(/^"|"$/g, '');
  const passiveFormatted = formatSkillOrTrait(fighter.passiveTrait);
  const skillFormatted = formatSkillOrTrait(fighter.specialSkill);

  return [
    border,
    `   LUCHADOR ${label}`,
    border,
    '',
    `👑 *${fighter.name.toUpperCase()}*`,
    `_"${rawEpithet}"_`,
    '',
    `🏛️ _Raza y Facción_`,
    `${fighter.raceName} · ${fighter.faction}`,
    '',
    `🛡️ _Arma_`,
    `${fighter.weapon}`,
    '',
    `⚖️ _Complexión_`,
    `${fighter.height} · ${fighter.weight}`,
    '',
    `━━━ 📊 ATRIBUTOS ━━━`,
    `FUE ${fighter.stats.str} │ DES ${fighter.stats.dex} │ CON ${fighter.stats.con}`,
    `ARC ${fighter.stats.arc} │ RES ${fighter.stats.res}`,
    '',
    `━━━ 📈 COMBATE ━━━`,
    `💥 ${fighter.metrics.forceKn} kN de impacto`,
    `🏃 ${fighter.metrics.speedMs} m/s`,
    `⚡ ${fighter.metrics.reactionMs} ms de reacción`,
    '',
    `🩸 *Salud Máxima:* ${fighter.maxHp} HP`,
    '',
    `⚔️ _Rasgo Pasivo_`,
    passiveFormatted,
    '',
    `✨ _Habilidad Especial_`,
    skillFormatted,
    '',
    `💰 *Multiplicador de Ganancia:* ${fighter.odds}x`,
    '',
    border,
    '',
    `👉 Cita este mensaje con`,
    `*"!apostar <monto>"*`,
    `para apostar por este gladiador`,
  ].join('\n');
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
  const fighterAText = formatFighterCard(fighterA, 'A', '🗡️');

  // 3. Ficha Técnica de Gladiador B
  const fighterBText = formatFighterCard(fighterB, 'B', '🪓');

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
    if (quoted) {
      target = findColosseumBetTargetByQuotedId(quoted.id, quoted.body);
    }
  }

  // Fallback if user typed "!apostar 1 5000" or "!apostar A 5000" or "!apostar 2 10000"
  let parsedAmount = 0;
  const cleanBody = commandBody.replace(/^!apostar\s*/i, '').trim();
  const tokens = cleanBody.split(/\s+/).filter(Boolean);

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
    parsedAmount = parseGoldAmount(cleanBody);
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
  const rawEpithetA = (active.fighterA.epithet || '').replace(/^"|"$/g, '');
  const rawEpithetB = (active.fighterB.epithet || '').replace(/^"|"$/g, '');

  const introArenaText = [
    '⚔️━━━━━━━━━━━━━━━━━━━━⚔️',
    '𝕰𝕷 𝕮𝕺𝕷𝕴𝕾𝕰𝕺 𝕯𝕰 𝕷𝕬𝕾',
    '𝕽𝕬𝖅𝕬𝕾 𝕳𝕬 𝕮𝕺𝕸𝕰𝕹𝖅𝕬𝕯𝕺',
    '⚔️━━━━━━━━━━━━━━━━━━━━⚔️',
    '',
    '_Las puertas de hierro forjado se abren',
    'con estruendo sobre las arenas doradas._',
    '',
    '🔵 *ESQUINA NORTE*',
    `*${active.fighterA.name}* — _${rawEpithetA}_`,
    `🗡️ ${active.fighterA.weapon}`,
    '',
    '🔴 *ESQUINA SUR*',
    `*${active.fighterB.name}* — _${rawEpithetB}_`,
    `🪓 ${active.fighterB.weapon}`,
    '',
    '⚔️━━━━━━━━━━━━━━━━━━━━⚔️',
    '',
    '🩸 *¡Los contendientes lucharán',
    'hasta que uno caiga a 0 HP!*',
    '',
  ].join('\n');

  await client.sendMessage(active.roleplayChatId, introArenaText).catch(() => null);

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

    if (combatNarrative.hasError) {
      const errorNotice = [
        `⚠️ *[AVISO DE COLISEO: Falla en Oráculo de IA]*`,
        `Se detectó un problema en la generación narrativa por IA:`,
        `\`${combatNarrative.errorMessage}\``,
        `📌 *Detalles en Logs:* Revisa los registros del servidor. Se continúa con la simulación procedural de combate.`,
      ].join('\n');
      await client.sendMessage(active.roleplayChatId, errorNotice).catch(() => null);
    }

    const rawEpithetAttacker = (attacker.epithet || '').replace(/^"|"$/g, '');
    const rawEpithetDefender = (defender.epithet || '').replace(/^"|"$/g, '');

    // Message 1: Attacker Structured Roleplay
    const attackText = [
      `⚔️ [ASALTO ${roundNum} · ${attacker.name.toUpperCase()}]`,
      '',
      `┍━━━━━━━━━┙💥┕━━━━━━━━━┑`,
      `╔═══❖•°❲⚔️❳°•❖═══╗`,
      `  ${attacker.name} — "${rawEpithetAttacker}"`,
      `╚═══❖•°❲⚔️❳ °❖═══╝`,
      `┕━━━━━━━━━┑⚔️┍━━━━━━━━━┙`,
      `《Ambientación de la Arena》`,
      `> ${combatNarrative.ambientation}`,
      '',
      `_*|Intencionalidad / Ataque|*_`,
      `_${combatNarrative.attackNarrative}_`,
      '',
      `|⚔️|➥ 💭 (${combatNarrative.attackerThought})`,
      '',
      `|⚔️|➥ 💬 — ${combatNarrative.attackerDialogue}`,
    ].join('\n');

    const sentAttackMsg = await client.sendMessage(active.roleplayChatId, attackText).catch(() => null);

    await sleep(Math.min(3000, active.combatIntervalMs / 10));

    // Message 2: Defender Reaction Structured Roleplay
    const defendText = [
      `🛡️ [REACCIÓN · ${defender.name.toUpperCase()}]`,
      '',
      `┍━━━━━━━━━┙🛡️┕━━━━━━━━━┑`,
      `╔═══❖•°❲🛡️❳°•❖═══╗`,
      `  ${defender.name} — "${rawEpithetDefender}"`,
      `╚═══❖•°❲🛡️❳ °❖═══╝`,
      `┕━━━━━━━━━┑🛡️┍━━━━━━━━━┙`,
      `《Respuesta Táctica》`,
      `> ${combatNarrative.tacticalResponse}`,
      '',
      `_*|Contraataque / Defensa|*_`,
      `_${combatNarrative.defenseNarrative}_`,
      '',
      `|🛡️|➥ 💭 (${combatNarrative.defenderThought})`,
      '',
      `|🛡️|➥ 💬 — ${combatNarrative.defenderDialogue}`,
    ].join('\n');

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

function generateProceduralFallbackExchange(attacker, defender, roundNum, err = null) {
  if (err) {
    console.error(`[generateCombatExchange.error] Error en IA (Asalto ${roundNum}):`, err.stack || err.message || err);
  }

  const baseDmg = Math.round(18 + (attacker.stats.str * 2.2) + (attacker.weaponBonusAtk || 0) - (defender.stats.con * 1.1));
  const finalDmg = Math.max(15, Math.min(45, baseDmg + Math.floor(Math.random() * 8)));

  const ambientations = [
    `El zumbido electromagnético y la energía mística del combate cortan el aire del coliseo Imperial. El calor de la contienda evapora las microgotas de agua estancada entre los bloques de basalto, pero la atmósfera del recinto comienza a espesarse de forma antinatural. La mampostería derruida y el suelo abisal responden a una frecuencia sorda, mientras la densidad del aire alrededor de los pilares de piedra se vuelve quebradiza preparando el escenario para el choque.`,
    `Ondas de presión arcana y vapor ionizado brotan de la tierra sacudida de la arena. Las grietas subterráneas liberan filtraciones de calor mientras los destellos de luz solar filtrados por la cúpula hacen oscilar sombras grotescas sobre la cimentación de mithril. Toda la estructura del coliseo retumba ante el inminente impacto entre la facción ${attacker.faction} y la guardia defensiva de ${defender.faction}.`,
    `Un silencio denso precede a la fractura de la piedra. Chispas de energía elemental y polvo de basalto orbitan erráticamente en el aire alrededor de las botas de los combatientes. El rozamiento del aire ionizado genera una barrera de refracción física que altera los coeficientes de fricción del suelo y desafía la solidez de los puntos de apoyo.`,
  ];

  const attackNarratives = [
    `${attacker.name} contempla el despliegue del rival con compostura gélida. Sin perder un solo instante, desplaza su pie de apoyo a ${attacker.metrics.speedMs} m/s sobre las losas agrietadas y desata una ráfaga devastadora con su ${attacker.weapon}. Impregnando cada movimiento de una potencia cinética calculada de ${attacker.metrics.forceKn} kN, avanza proyectando una estela de fuerza física pura dirigida a quebrantar los puntos ciegos de la guardia enemiga.`,
    `Canalizando el poder innato de su raza (${attacker.raceName}) y ejecutando su técnica especial *${attacker.specialSkill}*, ${attacker.name} ajusta su centro de gravedad en una postura marcial impecable. Con una aceleración explosiva de ${attacker.metrics.speedMs} m/s, descarga su ${attacker.weapon} proyectando ondas de choque que agrietan la piedra abisal e impactan directamente en el flanco del oponente.`,
    `${attacker.name} extiende su brazo principal coordinando cada músculo y articulación mecánica con precisión milimétrica. Tras escanear la mampostería y los desniveles del suelo, inicia una acometida continua con su ${attacker.weapon}, combinando fintas de velocidad extrema y estocadas cargadas con ${attacker.metrics.forceKn} kN de impacto directo.`,
  ];

  const attackerThoughts = [
    `Un impacto de ${attacker.metrics.forceKn} kN a este ángulo romperá la constante gravitacional y el centro de masa del rival, siempre que sus reflejos no logren superar la ventana de ${defender.metrics.reactionMs} ms.`,
    `Su armadura y densidad física son elevadas, pero el coeficiente de fricción del basalto está a mi favor. Si no reajusta su algoritmo de estabilidad inmediatamente, su guardia colapsará en esta ráfaga.`,
    `Sobreestima la firmeza de la piedra sobre la que se yergue. Mi software ha previsto cada vector de escape; el escenario mismo se convertirá en su mayor enemigo en este asalto.`,
  ];

  const attackerDialogues = [
    `Un arma elegante y una postura rígida son herramientas inútiles cuando la masa del suelo y la fricción obedecen a mi impulso. ¡Demuéstrame cómo resistes el peso de ${attacker.faction}!`,
    `Acomoda tus algoritmos a un espacio donde la estructura no es fija. Tu velocidad de ${defender.metrics.speedMs} m/s no salvará tu armadura del acero.`,
    `Demasiado predecible. La firmeza de las arenas doradas acaba de terminar bajo tus pies.`,
  ];

  const tacticalResponses = [
    `El impacto kinetico desata una alteración de vectores en cadena: los pesados bloques de piedra fracturada que flanquean el área multiplican su masa aparente, hundiéndose violentamente en el suelo para agrietar la cimentación abisal y distorsionar el punto de apoyo del defensor.`,
    `Simultáneamente, la onda de choque invierte la constante gravitacional local sobre las lascas de piedra suelta y las microgotas de agua, creando una barrera flotante de vapor ionizado que arruina la solidez del terreno para la postura de combate.`,
    `La vibración telúrica resuena a través de la mampostería derruida, quebrando la línea de visión directa y dejando una estela de fricción reducida sobre las baldosas de basalto.`,
  ];

  const defenseNarratives = [
    `${defender.name} procesa la amenaza en apenas ${defender.metrics.reactionMs} ms de reacción instintiva. Lejos de ceder el terreno, inclina el torso e interpone la pesada guardia de su ${defender.weapon} para contener la embestida de ${attacker.metrics.forceKn} kN. Aunque la estructura de su armadura absorbe la mayor parte de la fricción cinética, el brutal desgaste de ${finalDmg} HP hace crujir sus ligamentos y desplaza su centro de apoyo dos metros hacia atrás.`,
    `Demostrando el temple de su facción (${defender.faction}), ${defender.name} activa su rasgo pasivo *${defender.passiveTrait}* en el último instante. A pesar de recibir un impacto directo de ${finalDmg} de daño en su fuselaje defensivo, utiliza la propia inercia del golpe para girar sobre su eje y reajustar su equilibrio en el centro de la sala.`,
    `${defender.name} maniobra con agilidad felina a través de las lascas de piedra levitantes. Aunque el tajo de ${attacker.name} logra rozar su armadura infringiendo ${finalDmg} HP de daño por abrasión, ${defender.name} sostiene la postura e inicia la canalización de su réplica táctica.`,
  ];

  const defenderThoughts = [
    `La magnitud del impacto (${attacker.metrics.forceKn} kN) excede los parámetros habituales... debo reconfigurar de inmediato los algoritmos de masa y disipación de calor para no perder la cimentación.`,
    `Cálculo de daño recibido: ${finalDmg} de daño directo. Su impulso ha sido registrado en mi matriz táctica; el siguiente vector de ataque será completamente predecible.`,
    `Un impacto contundente que altera la fricción de mi calzado, pero mi centro de gravedad permanece intacto. Es momento de ejecutar el contraataque.`,
  ];

  const defenderDialogues = [
    `Herramientas fascinantes y un despliegue de fuerza considerable... Sin embargo, el cálculo más perfecto se desmorona cuando las constantes del entorno cambian. ¡Veamos cómo responde tu software a mi réplica!`,
    `Un golpe elegante para un terreno predecible. Sin embargo, sobreestimas la fragilidad de mi defensa. Mi turno.`,
    `Tu impulso ha sido absorbido. Reajusta tu postura antes de que el terreno bajo tus pies se convierta en tu propia trampa.`,
  ];

  const idxA = roundNum % attackNarratives.length;
  const idxD = roundNum % defenseNarratives.length;

  return {
    ambientation: ambientations[idxA],
    attackNarrative: attackNarratives[idxA],
    attackerThought: attackerThoughts[idxA],
    attackerDialogue: attackerDialogues[idxA],
    tacticalResponse: tacticalResponses[idxD],
    defenseNarrative: defenseNarratives[idxD],
    defenderThought: defenderThoughts[idxD],
    defenderDialogue: defenderDialogues[idxD],
    damage: finalDmg,
    buff: roundNum === 2 ? 'Impulso Táctico' : null,
    nerf: finalDmg > 28 ? 'Guardia Fracturada' : null,
    tacticalSituation: `${attacker.name} presiona con ventaja táctica en el centro de la arena.`,
    hasError: Boolean(err),
    errorMessage: err ? (err.message || String(err)) : null,
  };
}

async function generateCombatExchange(attacker, defender, roundNum) {
  const prompt = `Simula el Asalto ${roundNum} de un combate PvP en el Coliseo Imperial de Kingdoom en formato de rol literario estructurado y amplio (alrededor de 300 palabras en total con narrativa literaria extendida y profunda).

ATACANTE: ${attacker.name} (${attacker.fullName})
- Raza: ${attacker.raceName} (${attacker.faction})
- Arma: ${attacker.weapon}
- Atributos: FUE ${attacker.stats.str}, DES ${attacker.stats.dex}, CON ${attacker.stats.con}, ARC ${attacker.stats.arc}, RES ${attacker.stats.res}
- Métricas: Fuerza ${attacker.metrics.forceKn} kN, Vel ${attacker.metrics.speedMs} m/s, Reacción ${attacker.metrics.reactionMs} ms
- Rasgo Pasivo: ${attacker.passiveTrait}
- Habilidad Especial: ${attacker.specialSkill}

DEFENSOR: ${defender.name} (${defender.fullName})
- Raza: ${defender.raceName} (${defender.faction})
- Arma: ${defender.weapon}
- Atributos: FUE ${defender.stats.str}, DES ${defender.stats.dex}, CON ${defender.stats.con}, ARC ${defender.stats.arc}, RES ${defender.stats.res}
- Métricas: Fuerza ${defender.metrics.forceKn} kN, Vel ${defender.metrics.speedMs} m/s, Reacción ${defender.metrics.reactionMs} ms
- Rasgo Pasivo: ${defender.passiveTrait}
- Habilidad Especial: ${defender.specialSkill}

Genera un JSON estrictamente válido con exactamente este esquema:
{
  "ambientation": "Descripción inmersiva de 3 a 5 líneas del entorno, la atmósfera, la física de la sala, vapor, basalto o magia residual.",
  "attackNarrative": "Descripción en prosa literaria extensa de 6 a 9 líneas del atacante ejecutando su golpe, desplazamiento de pies o habilidad especial con lujo de detalles tácticos y físicos.",
  "attackerThought": "Monólogo interno táctico amplio del atacante evaluando el terreno, los vectores de movimiento o la guardia del enemigo.",
  "attackerDialogue": "Línea de diálogo desafiante, técnica o letal del atacante.",
  "tacticalResponse": "Descripción inmersiva de 3 a 5 líneas de cómo reacciona la arena, el suelo y la física del espacio ante el impacto.",
  "defenseNarrative": "Descripción en prosa literaria extensa de 6 a 9 líneas del defensor maniobrando, bloqueando, absorbiendo la energía o sufriendo desgaste en la armadura.",
  "defenderThought": "Monólogo interno táctico amplio del defensor adaptando sus algoritmos/magia al impacto recibido y preparando su réplica.",
  "defenderDialogue": "Línea de diálogo de réplica, frialdad o resistencia del defensor.",
  "damage": número entero de daño entre 15 y 45,
  "buff": "Buff ganado por el atacante (ej. 'Impulso Táctico', 'Furia Resonante') o null",
  "nerf": "Herida/nerf sufrido por el defensor (ej. 'Guardia Fracturada', 'Corte de Viento') o null",
  "tacticalSituation": "Frase corta de la situación táctica tras el choque"
}`;

  try {
    const rawAiResponse = await askKingdoomAI([], prompt, {
      maxOutputTokens: 1200,
      temperature: 0.85,
    });

    const jsonMatch = rawAiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        ambientation: parsed.ambientation || `El choque electromagnético entre ${attacker.name} y ${defender.name} retumba en los bloques de basalto del coliseo.`,
        attackNarrative: parsed.attackNarrative || `${attacker.name} avanza a ${attacker.metrics.speedMs} m/s descargando un tajo masivo con su ${attacker.weapon}.`,
        attackerThought: parsed.attackerThought || `Un impacto directo de ${attacker.metrics.forceKn} kN quebrará su centro de masa.`,
        attackerDialogue: parsed.attackerDialogue || `¡Demuéstrame si tu armadura soporta el peso del acero!`,
        tacticalResponse: parsed.tacticalResponse || `Ondas de presión se expanden levantando lascas de piedra suelta alrededor de ${defender.name}.`,
        defenseNarrative: parsed.defenseNarrative || `${defender.name} reacciona en ${defender.metrics.reactionMs} ms interponiendo su ${defender.weapon} para contener la embestida.`,
        defenderThought: parsed.defenderThought || `El cálculo de impacto requiere estabilizar los algoritmos de defensa inmediatamente.`,
        defenderDialogue: parsed.defenderDialogue || `Un golpe contundente, pero la piedra aún no ha cedido.`,
        damage: Number.isFinite(parsed.damage) ? Math.max(12, Math.min(50, parsed.damage)) : 25,
        buff: parsed.buff || null,
        nerf: parsed.nerf || null,
        tacticalSituation: parsed.tacticalSituation || `${attacker.name} mantiene la iniciativa en el foso de arena.`,
        hasError: false,
      };
    }
  } catch (err) {
    return generateProceduralFallbackExchange(attacker, defender, roundNum, err);
  }

  return generateProceduralFallbackExchange(attacker, defender, roundNum, new Error('Respuesta de IA vacía o no válida.'));
}
