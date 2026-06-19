import crypto from 'crypto';
import { getPlayer, updateGold, getBlackjackUsage, incrementBlackjackUsage } from '../supabase.js';
import { heraldCard, heraldStat } from '../formatting.js';
import { resolvePlayerTarget } from '../targetResolver.js';
import { normalizePhone } from '../adminStore.js';

// Memory store for active blackjack sessions.
// Key: botMsgId (quoted message ID)
// Value: { isMultiplayer, playerId, playerPhone, username, bet, deck, playerCards, dealerCards, players, groupChatId, timeoutRef }
export const activeSessions = new Map();

// Helper to check if a user already has an active session.
function getActiveSessionByPlayerId(playerId) {
  for (const [msgId, session] of activeSessions.entries()) {
    if (session.isMultiplayer) {
      if (session.players.some(p => p.playerId === playerId)) {
        return { msgId, session };
      }
    } else {
      if (session.playerId === playerId) {
        return { msgId, session };
      }
    }
  }
  return null;
}

// Generate a standard 52-card deck
function createDeck() {
  const suits = [
    { name: 'Corazones', symbol: '❤️' },
    { name: 'Diamantes', symbol: '♦️' },
    { name: 'Tréboles', symbol: '♣️' },
    { name: 'Espadas', symbol: '♠️' }
  ];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const deck = [];
  for (const suit of suits) {
    for (const value of values) {
      deck.push({ value, suit });
    }
  }
  return deck;
}

// Shuffle deck using Fisher-Yates algorithm
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Calculate the blackjack hand value
export function calculateHand(hand) {
  let value = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.value === 'A') {
      value += 11;
      aces += 1;
    } else if (['J', 'Q', 'K'].includes(card.value)) {
      value += 10;
    } else {
      value += parseInt(card.value, 10);
    }
  }
  while (value > 21 && aces > 0) {
    value -= 10;
    aces -= 1;
  }
  return value;
}

// Helper to format a card
function formatCard(card) {
  return `${card.value}${card.suit.symbol}`;
}

// Helper to format multiple cards
function formatHand(hand) {
  return hand.map(formatCard).join(', ');
}

// Helper to format the multiplayer board status
function formatMultiplayerBoard(session) {
  const lines = [
    `Apuesta: *${session.bet.toLocaleString('es-PY')} oro* por jugador`,
    `Pozo acumulado: *${(session.bet * session.players.length).toLocaleString('es-PY')} oro*`,
    `---`,
    `⚔️ *ESTADO DE LOS JUGADORES:*`
  ];

  for (const p of session.players) {
    const total = calculateHand(p.cards);
    let statusText = '';
    if (p.status === 'busted') {
      statusText = ` 💀 *Bust* (${total})`;
    } else if (p.status === 'stand') {
      statusText = ` 🛡️ *Plantado* (${total})`;
    } else {
      statusText = ` (${total})`;
    }
    
    let voteIndicator = '';
    if (p.status === 'playing') {
      voteIndicator = p.responseReceived ? ' (Votó ✅)' : ' (Esperando 🕒)';
    }

    lines.push(`👤 *${p.username}*:\n   [${formatHand(p.cards)}]${statusText}${voteIndicator}`);
  }

  lines.push(`---`);

  const activePlayers = session.players.filter(p => p.status === 'playing');
  if (activePlayers.length > 0) {
    const waitingList = activePlayers.filter(p => !p.responseReceived).map(p => `*${p.username}*`).join(', ');
    lines.push(`Esperando respuestas... (${session.players.filter(p => p.status === 'playing' && p.responseReceived).length}/${activePlayers.length})`);
    lines.push(`Falta que respondan: ${waitingList}`);
    lines.push(`---`);
    lines.push(`💬 *Respondé a este mensaje* con:`);
    lines.push(`• *pedir* (tomar otra carta)`);
    lines.push(`• *plantarse* (quedarte con tus cartas)`);
  } else {
    lines.push(`Partida finalizada. Procesando resultados...`);
  }

  return heraldCard('21 (Blackjack PvP)', lines, { icon: '🃏' });
}

// Handle starting a game with `!21 <apuesta>` (Supports solo or multiplayer)
export async function handleBlackjack(msg, client) {
  const parts = msg.body.split(' ');
  const apuesta = parseInt(parts[1], 10);
  const sender = msg.author || msg.from;

  // Extract all @username text tags
  const tagsFound = [];
  const body = msg.body || '';
  const tagRegex = /@([^\s@]+)/g;
  let match;
  while ((match = tagRegex.exec(body)) !== null) {
    tagsFound.push(match[1]);
  }

  const hasMentions = (msg.mentionedIds && msg.mentionedIds.length > 0) || tagsFound.length > 0;

  // --- SOLO MODE (Traditional) ---
  if (!hasMentions) {
    const player = await getPlayer(sender);
    if (!player) return `⚔️ No estás registrado. Escribí *!registrar TuNombre*`;
    if (!apuesta || isNaN(apuesta) || apuesta < 10) return `🃏 Usá: *!21 100* (mínimo 10 oro)`;
    if (apuesta > player.gold) return `❌ No tenés suficiente oro.\n🪙 Tenés: ${player.gold.toLocaleString('es-PY')}`;

    const existing = getActiveSessionByPlayerId(player.id);
    if (existing) {
      return `❌ Ya tenés una partida de Blackjack activa en curso. Respondé a ese mensaje para continuar.`;
    }

    const dayOfWeek = new Date().getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const maxUsos = 5; // Updated limit: 5 usages daily
    const maxApuesta = isWeekend ? 500000 : 100000;

    if (apuesta > maxApuesta) {
      return `🃏 La apuesta máxima de Blackjack por ronda es de *${maxApuesta.toLocaleString('es-PY')} oro*${isWeekend ? ' durante el fin de semana' : ''}.`;
    }

    const currentUsos = await getBlackjackUsage(player.id);
    if (currentUsos >= maxUsos) {
      return `🃏 Alcanzaste el límite diario de Blackjack (${maxUsos}/${maxUsos}). ¡Volvé mañana para probar tu suerte!`;
    }

    try {
      await updateGold(player.id, -apuesta);
      await incrementBlackjackUsage(player.id);
    } catch (err) {
      console.error('[handleBlackjack] updateGold error:', err.message);
      return `⚔️ Error al registrar la apuesta. Intentá de nuevo.`;
    }

    const deck = shuffle(createDeck());
    const playerCards = [deck.pop(), deck.pop()];
    const dealerCards = [deck.pop(), deck.pop()];

    const playerTotal = calculateHand(playerCards);
    const dealerTotal = calculateHand(dealerCards);

    const playerHasNatural = playerTotal === 21;
    const dealerHasNatural = dealerTotal === 21;

    if (playerHasNatural || dealerHasNatural) {
      let outcomeText = '';
      let finalPayout = 0;
      
      if (playerHasNatural && dealerHasNatural) {
        finalPayout = apuesta;
        outcomeText = `⚖️ *¡Empate Natural!* Ambos tienen Blackjack.\nReembolso de *${apuesta.toLocaleString('es-PY')} oro*.`;
      } else if (playerHasNatural) {
        finalPayout = Math.floor(apuesta * 2.5);
        outcomeText = `✨ *¡Blackjack Natural!* ¡Ganaste!\nRecibís *${finalPayout.toLocaleString('es-PY')} oro* (2.5x).`;
      } else {
        finalPayout = 0;
        outcomeText = `💀 *¡El crupier tiene Blackjack Natural!* Perdiste.\nPerdiste *${apuesta.toLocaleString('es-PY')} oro*.`;
      }

      if (finalPayout > 0) {
        await updateGold(player.id, finalPayout);
      }

      const updatedPlayer = await getPlayer(sender);
      const newGold = updatedPlayer ? updatedPlayer.gold : player.gold - apuesta + finalPayout;

      return heraldCard('21 (Blackjack)', [
        `Aventurero: *${player.username}*`,
        `Apuesta: *${apuesta.toLocaleString('es-PY')} oro*`,
        `---`,
        `🃏 *TUS CARTAS:*`,
        `[${formatHand(playerCards)}] (Total: *${playerTotal}*)`,
        `---`,
        `🏛️ *CRUPIER:*`,
        `[${formatHand(dealerCards)}] (Total: *${dealerTotal}*)`,
        `---`,
        outcomeText,
        heraldStat('Nuevo total', `${newGold.toLocaleString('es-PY')} oro`),
        heraldStat('Usos restantes', `${maxUsos - (currentUsos + 1)}/${maxUsos}`)
      ], { icon: '🃏' });
    }

    const boardText = heraldCard('21 (Blackjack)', [
      `Aventurero: *${player.username}*`,
      `Apuesta: *${apuesta.toLocaleString('es-PY')} oro*`,
      `---`,
      `🃏 *TUS CARTAS:*`,
      `[${formatHand(playerCards)}] (Total: *${playerTotal}*)`,
      `---`,
      `🏛️ *CRUPIER:*`,
      `[${formatCard(dealerCards[0])}, ?] (Total: ?)`,
      `---`,
      `💬 *Respondé a este mensaje* con:`,
      `• *pedir* (tomar otra carta)`,
      `• *plantarse* (quedarte con tus cartas)`
    ], { icon: '🃏' });

    const replyMsg = await msg.reply(boardText);
    activeSessions.set(replyMsg.id._serialized, {
      isMultiplayer: false,
      playerId: player.id,
      playerPhone: sender,
      username: player.username,
      bet: apuesta,
      playerCards,
      dealerCards,
      deck,
      maxUsos,
      currentUsos: currentUsos + 1
    });

    return null;
  }

  // --- MULTIPLAYER MODE (PvP) ---
  if (!apuesta || isNaN(apuesta) || apuesta < 10) {
    return `🃏 Usá: *!21 100 @jugador* (mínimo 10 oro)`;
  }

  const hostPlayer = await getPlayer(sender);
  if (!hostPlayer) return `⚔️ No estás registrado. Escribí *!registrar TuNombre*`;

  // Resolve all participants
  const participants = [];
  participants.push({
    player: hostPlayer,
    phone: sender,
    isHost: true
  });

  // Resolve JID mentions from WhatsApp
  const mentionedIds = msg.mentionedIds || [];
  for (const jid of mentionedIds) {
    const phone = normalizePhone(jid);
    if (phone === normalizePhone(sender)) continue;
    if (participants.some(p => normalizePhone(p.phone) === phone)) continue;
    
    const player = await getPlayer(jid);
    if (!player) {
      return `❌ El jugador con teléfono *${phone}* no está registrado en el reino.`;
    }
    participants.push({
      player,
      phone: jid,
      isHost: false
    });
  }

  // Resolve text-based @username tags
  for (const tag of tagsFound) {
    const resolved = await resolvePlayerTarget(msg, tag);
    if (!resolved.ok || !resolved.player) {
      return `❌ No se encontró al aventurero *@${tag}* en los registros del reino.`;
    }
    const phone = normalizePhone(resolved.phone);
    if (phone === normalizePhone(sender)) continue;

    if (!participants.some(p => normalizePhone(p.phone) === phone)) {
      participants.push({
        player: resolved.player,
        phone: resolved.phone,
        isHost: false
      });
    }
  }

  if (participants.length < 2) {
    return `❌ Debés etiquetar al menos a otro jugador para jugar multijugador.\nUso: *!21 500 @jugador*`;
  }

  // Validate bets, active sessions, and limits for all participants
  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const maxUsos = 5;
  const maxApuesta = isWeekend ? 500000 : 100000;

  if (apuesta > maxApuesta) {
    return `🃏 La apuesta máxima de Blackjack por ronda es de *${maxApuesta.toLocaleString('es-PY')} oro*${isWeekend ? ' durante el fin de semana' : ''}.`;
  }

  for (const p of participants) {
    if (p.player.gold < apuesta) {
      return `❌ El aventurero *${p.player.username}* no tiene suficiente oro (monto: ${apuesta.toLocaleString('es-PY')} 🪙).`;
    }
    const currentUsos = await getBlackjackUsage(p.player.id);
    if (currentUsos >= maxUsos) {
      return `❌ El aventurero *${p.player.username}* ya alcanzó su límite diario de Blackjack (${maxUsos}/${maxUsos}).`;
    }
    const active = getActiveSessionByPlayerId(p.player.id);
    if (active) {
      return `❌ El aventurero *${p.player.username}* ya tiene una partida de Blackjack activa en curso.`;
    }
  }

  const playersState = [];
  for (const p of participants) {
    playersState.push({
      playerId: p.player.id,
      playerPhone: normalizePhone(p.phone),
      username: p.player.username,
      cards: [],
      status: p.isHost ? 'accepted' : 'pending',
      responseReceived: p.isHost ? true : false,
      lastAction: null,
      isHost: p.isHost
    });
  }

  const session = {
    isMultiplayer: true,
    state: 'pending',
    bet: apuesta,
    players: playersState,
    deck: null,
    groupChatId: msg.from,
    timeoutRef: null
  };

  const invitedNames = playersState.filter(p => !p.isHost).map(p => `*${p.username}*`).join(', ');
  const boardText = heraldCard('21 (Blackjack PvP) - Reto', [
    `⚔️ *${hostPlayer.username}* ha desafiado a ${invitedNames} por *${apuesta.toLocaleString('es-PY')} oro*.`,
    `---`,
    `💬 Los retados deben responder a este mensaje con:`,
    `• *aceptar*`,
    `• *negar*`
  ], { icon: '⚔️' });

  const replyMsg = await msg.reply(boardText);
  const sessionId = replyMsg.id._serialized;

  // Set timeout of 5 minutes (300,000 ms)
  session.timeoutRef = setTimeout(() => {
    handleMultiplayerTimeout(client, sessionId);
  }, 5 * 60 * 1000);

  activeSessions.set(sessionId, session);
  return null;
}

// Handle reply message directed at an active blackjack game message
export async function handleBlackjackReply(msg, session, sessionId, client) {
  if (session.isMultiplayer) {
    const sender = normalizePhone(msg.author || msg.from);
    const playerInSession = session.players.find(p => p.playerPhone === sender);

    if (!playerInSession) {
      return null; // Ignore replies from non-participants
    }

    if (session.state === 'pending') {
      if (playerInSession.status !== 'pending') {
        return `⚔️ *${playerInSession.username}*, ya respondiste a este reto.`;
      }

      const action = msg.body.trim().toLowerCase();
      if (action !== 'aceptar' && action !== 'negar') {
        return `⚔️ Solo podés responder con *aceptar* o *negar*.`;
      }

      playerInSession.status = action === 'aceptar' ? 'accepted' : 'denied';
      playerInSession.responseReceived = true;

      try {
        await msg.react(action === 'aceptar' ? '✅' : '❌');
      } catch (e) { }

      const pendingPlayers = session.players.filter(p => p.status === 'pending');
      if (pendingPlayers.length === 0) {
        await startMultiplayerGame(client, sessionId, session, session.groupChatId);
      }
      return null;
    }

    if (playerInSession.status !== 'playing') {
      return `⚔️ *${playerInSession.username}*, ya no estás activo en esta partida (te plantaste o te pasaste).`;
    }

    if (playerInSession.responseReceived) {
      return `⚔️ *${playerInSession.username}*, ya enviaste tu decisión para esta ronda. Esperá a los demás.`;
    }

    const action = msg.body.trim().toLowerCase();
    if (action !== 'pedir' && action !== 'plantarse') {
      return `⚔️ Solo podés responder con *pedir* o *plantarse*.`;
    }

    // Record player action
    playerInSession.lastAction = action;
    playerInSession.responseReceived = true;

    // React with emoji to confirm vote receipt
    try {
      await msg.react('✅');
    } catch (e) {
      console.warn('[handleBlackjackReply] msg.react error:', e.message);
    }

    // Check if all active players responded
    const activePlayers = session.players.filter(p => p.status === 'playing');
    const allResponded = activePlayers.every(p => p.responseReceived);

    if (allResponded) {
      resolveMultiplayerRound(client, sessionId, session, session.groupChatId).catch(console.error);
    }

    return null;
  } else {
    // --- SOLO MODE REPLY FLOW ---
    const sender = msg.author || msg.from;
    const action = msg.body.trim().toLowerCase();

    if (action !== 'pedir' && action !== 'plantarse') {
      return `⚔️ Solo podés responder con *pedir* o *plantarse* en esta partida.`;
    }

    activeSessions.delete(sessionId);

    if (action === 'pedir') {
      const newCard = session.deck.pop();
      session.playerCards.push(newCard);
      const playerTotal = calculateHand(session.playerCards);

      if (playerTotal > 21) {
        const dealerTotal = calculateHand(session.dealerCards);
        const updatedPlayer = await getPlayer(session.playerPhone);
        const currentGold = updatedPlayer ? updatedPlayer.gold : 0;

        const bustText = heraldCard('21 (Blackjack)', [
          `Aventurero: *${session.username}*`,
          `Apuesta: *${session.bet.toLocaleString('es-PY')} oro*`,
          `---`,
          `🃏 *TUS CARTAS:*`,
          `[${formatHand(session.playerCards)}] (Total: *${playerTotal}*)`,
          `---`,
          `🏛️ *CRUPIER:*`,
          `[${formatHand(session.dealerCards)}] (Total: *${dealerTotal}*)`,
          `---`,
          `💀 *¡Te pasaste de 21! Derrota*`,
          `Perdiste *${session.bet.toLocaleString('es-PY')} oro*.`,
          heraldStat('Nuevo total', `${currentGold.toLocaleString('es-PY')} oro`),
          heraldStat('Usos restantes', `${session.maxUsos - session.currentUsos}/${session.maxUsos}`)
        ], { icon: '🃏' });

        await msg.reply(bustText);
        return null;
      }

      if (playerTotal === 21) {
        await runDealerTurn(msg, session);
        return null;
      }

      const updatedBoard = heraldCard('21 (Blackjack)', [
        `Aventurero: *${session.username}*`,
        `Apuesta: *${session.bet.toLocaleString('es-PY')} oro*`,
        `---`,
        `🃏 *TUS CARTAS:*`,
        `[${formatHand(session.playerCards)}] (Total: *${playerTotal}*)`,
        `---`,
        `🏛️ *CRUPIER:*`,
        `[${formatCard(session.dealerCards[0])}, ?] (Total: ?)`,
        `---`,
        `💬 *Respondé a este mensaje* con:`,
        `• *pedir* (tomar otra carta)`,
        `• *plantarse* (quedarte con tus cartas)`
      ], { icon: '🃏' });

      const replyMsg = await msg.reply(updatedBoard);
      activeSessions.set(replyMsg.id._serialized, session);
      return null;
    }

    if (action === 'plantarse') {
      await runDealerTurn(msg, session);
      return null;
    }
  }
}

// Execute the dealer's drawing logic and resolve game payouts (Solo game)
async function runDealerTurn(msg, session) {
  let dealerTotal = calculateHand(session.dealerCards);

  while (dealerTotal < 17) {
    session.dealerCards.push(session.deck.pop());
    dealerTotal = calculateHand(session.dealerCards);
  }

  const playerTotal = calculateHand(session.playerCards);
  let payout = 0;
  let resultText = '';

  if (dealerTotal > 21) {
    payout = session.bet * 2;
    resultText = `✨ *¡El crupier se pasó! Victoria.*\nGanás *${session.bet.toLocaleString('es-PY')} oro* (2x).`;
  } else if (playerTotal > dealerTotal) {
    payout = session.bet * 2;
    resultText = `✨ *¡Le ganaste al crupier! Victoria.*\nGanás *${session.bet.toLocaleString('es-PY')} oro* (2x).`;
  } else if (playerTotal === dealerTotal) {
    payout = session.bet;
    resultText = `⚖️ *¡Empate! Reembolso.*\nRecibís tus *${session.bet.toLocaleString('es-PY')} oro* de vuelta.`;
  } else {
    payout = 0;
    resultText = `💀 *¡El crupier tiene mejor mano! Derrota.*\nPerdiste *${session.bet.toLocaleString('es-PY')} oro*.`;
  }

  if (payout > 0) {
    try {
      await updateGold(session.playerId, payout);
    } catch (err) {
      console.error('[runDealerTurn] updateGold error:', err.message);
    }
  }

  const updatedPlayer = await getPlayer(session.playerPhone);
  const currentGold = updatedPlayer ? updatedPlayer.gold : 0;

  const finalText = heraldCard('21 (Blackjack)', [
    `Aventurero: *${session.username}*`,
    `Apuesta: *${session.bet.toLocaleString('es-PY')} oro*`,
    `---`,
    `🃏 *TUS CARTAS:*`,
    `[${formatHand(session.playerCards)}] (Total: *${playerTotal}*)`,
    `---`,
    `🏛️ *CRUPIER:*`,
    `[${formatHand(session.dealerCards)}] (Total: *${dealerTotal}*)`,
    `---`,
    resultText,
    heraldStat('Nuevo total', `${currentGold.toLocaleString('es-PY')} oro`),
    heraldStat('Usos restantes', `${session.maxUsos - session.currentUsos}/${session.maxUsos}`)
  ], { icon: '🃏' });

  await msg.reply(finalText);
}

async function startMultiplayerGame(client, sessionId, session, groupChatId) {
  if (session.timeoutRef) clearTimeout(session.timeoutRef);
  activeSessions.delete(sessionId);

  const accepted = session.players.filter(p => p.status === 'accepted');
  if (accepted.length < 2) {
    await client.sendMessage(groupChatId, `❌ No hay suficientes jugadores para iniciar el Blackjack PvP.`);
    return;
  }

  // Deduct gold and setup
  const finalPlayers = [];
  for (const p of accepted) {
    const dbPlayer = await getPlayer(p.playerPhone);
    const currentUsos = await getBlackjackUsage(p.playerId);
    if (!dbPlayer || dbPlayer.gold < session.bet || currentUsos >= 5) {
      await client.sendMessage(groupChatId, `⚠️ *${p.username}* fue excluido porque no tiene oro suficiente o alcanzó el límite de usos.`);
      continue;
    }
    
    await updateGold(p.playerId, -session.bet);
    await incrementBlackjackUsage(p.playerId);
    
    p.status = 'playing';
    p.responseReceived = false;
    p.lastAction = null;
    finalPlayers.push(p);
  }

  if (finalPlayers.length < 2) {
    for (const p of finalPlayers) {
        await updateGold(p.playerId, session.bet);
    }
    await client.sendMessage(groupChatId, `❌ No hay suficientes jugadores válidos para iniciar la partida. Reembolso emitido.`);
    return;
  }

  session.players = finalPlayers;
  session.deck = shuffle(createDeck());
  for (const p of session.players) {
    p.cards = [session.deck.pop()];
  }
  session.state = 'playing';

  const boardText = formatMultiplayerBoard(session);
  const replyMsg = await client.sendMessage(groupChatId, boardText);
  const newSessionId = replyMsg.id._serialized;

  session.timeoutRef = setTimeout(() => {
    handleMultiplayerTimeout(client, newSessionId);
  }, 5 * 60 * 1000);

  activeSessions.set(newSessionId, session);
}

// Resolve the current round in a multiplayer PvP session
async function resolveMultiplayerRound(client, sessionId, session, groupChatId) {
  if (session.timeoutRef) {
    clearTimeout(session.timeoutRef);
  }

  activeSessions.delete(sessionId);

  // Process all hits and stands
  for (const p of session.players) {
    if (p.status === 'playing') {
      if (p.lastAction === 'pedir') {
        const newCard = session.deck.pop();
        p.cards.push(newCard);
        const total = calculateHand(p.cards);
        if (total > 21) {
          p.status = 'busted';
        } else if (total === 21) {
          p.status = 'stand'; // Auto-stand on 21
        }
      } else if (p.lastAction === 'plantarse') {
        p.status = 'stand';
      }
    }
  }

  // Check if any players are still active
  const stillActive = session.players.some(p => p.status === 'playing');

  if (stillActive) {
    // Reset round responses for active players
    for (const p of session.players) {
      if (p.status === 'playing') {
        p.responseReceived = false;
        p.lastAction = null;
      }
    }

    const boardText = formatMultiplayerBoard(session);
    const replyMsg = await client.sendMessage(groupChatId, boardText);
    const newSessionId = replyMsg.id._serialized;

    // Set new timeout of 5 minutes
    session.timeoutRef = setTimeout(() => {
      handleMultiplayerTimeout(client, newSessionId);
    }, 5 * 60 * 1000);

    activeSessions.set(newSessionId, session);
  } else {
    // End of game, resolve payout and declare winners
    await finishMultiplayerGame(client, session, groupChatId);
  }
}

// Handle the multiplayer round timeout
async function handleMultiplayerTimeout(client, sessionId) {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) return;

    if (session.state === 'pending') {
      let changed = false;
      for (const p of session.players) {
        if (p.status === 'pending') {
          p.status = 'denied';
          p.responseReceived = true;
          changed = true;
        }
      }
      if (changed) {
        await startMultiplayerGame(client, sessionId, session, session.groupChatId);
      }
      return;
    }

    let changed = false;
    for (const p of session.players) {
      if (p.status === 'playing' && !p.responseReceived) {
        p.lastAction = 'plantarse';
        p.responseReceived = true;
        changed = true;
      }
    }

    if (changed) {
      await resolveMultiplayerRound(client, sessionId, session, session.groupChatId);
    }
  } catch (err) {
    console.error('[handleMultiplayerTimeout] Error:', err);
  }
}

// Process payouts and send final results for a multiplayer session
async function finishMultiplayerGame(client, session, groupChatId) {
  const nonBusted = session.players.filter(p => calculateHand(p.cards) <= 21);

  let winners = [];
  let maxScore = 0;

  if (nonBusted.length > 0) {
    maxScore = Math.max(...nonBusted.map(p => calculateHand(p.cards)));
    winners = nonBusted.filter(p => calculateHand(p.cards) === maxScore);
  }

  const lines = [
    `Apuesta: *${session.bet.toLocaleString('es-PY')} oro* por jugador`,
    `Pozo total: *${(session.bet * session.players.length).toLocaleString('es-PY')} oro*`,
    `---`,
    `🏁 *RESULTADOS FINALES:*`
  ];

  for (const p of session.players) {
    const total = calculateHand(p.cards);
    let statusText = '';
    if (total > 21) {
      statusText = ` 💀 *Bust* (${total})`;
    } else {
      statusText = ` 🛡️ *Plantado* (${total})`;
    }
    lines.push(`👤 *${p.username}*:\n   [${formatHand(p.cards)}]${statusText}`);
  }

  lines.push(`---`);

  if (winners.length > 0) {
    const pot = session.bet * session.players.length;
    const baseShare = Math.floor(pot / winners.length);
    const results = [];

    for (const w of winners) {
      const score = calculateHand(w.cards);
      let payout = baseShare;

      // Minimum payout guarantee (2.5x for 21 blackjack, 2x for regular win)
      if (score === 21) {
        payout = Math.max(payout, Math.floor(session.bet * 2.5));
      } else {
        payout = Math.max(payout, Math.floor(session.bet * 2.0));
      }

      try {
        await updateGold(w.playerId, payout);
      } catch (err) {
        console.error(`[finishMultiplayerGame] updateGold error for ${w.username}:`, err.message);
      }

      const updatedPlayer = await getPlayer(w.playerPhone);
      const newGold = updatedPlayer ? updatedPlayer.gold : 0;
      results.push(`🏆 *${w.username}* gana *${payout.toLocaleString('es-PY')} oro* (Total: ${newGold.toLocaleString('es-PY')} 🪙)`);
    }

    lines.push(results.join('\n'));
  } else {
    lines.push(`💀 *¡Todos se pasaron de 21!* La casa se queda con el pozo.`);
  }

  const finalCard = heraldCard('21 (Blackjack PvP) - Fin de Partida', lines, { icon: '🏆' });
  await client.sendMessage(groupChatId, finalCard);
}
