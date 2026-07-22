import { getPlayer, updateGold, getBlackjackUsage, incrementBlackjackUsage, placeBet, resolveBet } from '../supabase.js';
import { decorateCommandReply, heraldCard, heraldStat } from '../formatting.js';
import { resolvePlayerTarget } from '../targetResolver.js';
import { normalizePhone } from '../adminStore.js';
import { resolveWhatsAppPhones } from '../whatsappIdentity.js';

// Memory store for active blackjack sessions.
// Key: botMsgId (quoted message ID)
// Value: { isMultiplayer, playerId, playerPhone, username, bet, deck, playerCards, dealerCards, players, groupChatId, timeoutRef }
export const activeSessions = new Map();
const SOLO_SESSION_TIMEOUT_MS = 5 * 60 * 1000;

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
    const j = Math.floor(Math.random() * (i + 1));
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

function buildBlackjackSettlementPending(lines, payout) {
  return heraldCard('21 · Liquidacion pendiente', [
    ...lines,
    heraldStat('Pago sin confirmar', `${Number(payout ?? 0).toLocaleString('es-PY')} oro`),
    '⚠️ La mano termino, pero la base de datos no confirmo el movimiento de oro.',
    'La apuesta permanece en custodia y el recuperador la reembolsara si continua pendiente.',
  ], { icon: '🃏' });
}

function buildBlackjackSetupFailure(cancellationStatus) {
  const lines = cancellationStatus === 'refunded'
    ? [
        'La partida no llego a iniciarse.',
        'La apuesta creada durante el intento fue reembolsada de forma confirmada.',
      ]
    : [
        'No se pudo confirmar el registro completo de la apuesta.',
        'Si el oro llego a quedar retenido, permanece en custodia para recuperacion segura.',
        'Revisa tu saldo antes de iniciar otra partida.',
      ];

  return heraldCard('21 · Apuesta no iniciada', lines, { icon: '🃏' });
}

async function cancelBlackjackBet(betId, amount, context) {
  if (!betId) return 'unconfirmed';

  try {
    await resolveBet(betId, amount);
    return 'refunded';
  } catch (error) {
    console.error(`[${context}] No se pudo confirmar el reembolso compensatorio:`, error);
    return 'pending';
  }
}

async function refundBlackjackPlayers(players, amount, context) {
  const pendingRefunds = [];
  for (const player of players) {
    const status = await cancelBlackjackBet(player.betId, amount, `${context}.${player.username}`);
    if (status !== 'refunded') {
      pendingRefunds.push(player.username);
    }
  }
  return pendingRefunds;
}

async function getBlackjackGoldWithFallback(phone, fallback, context) {
  try {
    return (await getPlayer(phone))?.gold ?? fallback;
  } catch (error) {
    console.error(`[${context}] No se pudo refrescar el saldo confirmado:`, error);
    return fallback;
  }
}

function clearBlackjackSessionTimeout(session) {
  if (session?.timeoutRef) {
    clearTimeout(session.timeoutRef);
    session.timeoutRef = null;
  }
}

function registerSoloSession(client, sessionId, session) {
  clearBlackjackSessionTimeout(session);
  session.timeoutRef = setTimeout(() => {
    void handleSoloBlackjackTimeout(client, sessionId);
  }, SOLO_SESSION_TIMEOUT_MS);
  activeSessions.set(sessionId, session);
}

async function handleSoloBlackjackTimeout(client, sessionId) {
  const session = activeSessions.get(sessionId);
  if (!session || session.isMultiplayer) return;

  activeSessions.delete(sessionId);
  clearBlackjackSessionTimeout(session);

  let response;
  try {
    await resolveBet(session.betId, session.bet);
    response = heraldCard('21 · Partida expirada', [
      `Aventurero: *${session.username}*`,
      'La partida se cerro por inactividad.',
      heraldStat('Reembolso confirmado', `${session.bet.toLocaleString('es-PY')} oro`),
    ], { icon: '🃏' });
  } catch (error) {
    console.error('[handleSoloBlackjackTimeout] resolveBet error:', error);
    response = buildBlackjackSettlementPending([
      `Aventurero: *${session.username}*`,
      'La partida se cerro por inactividad.',
    ], session.bet);
  }

  try {
    await client.sendMessage(session.chatId, response);
  } catch (error) {
    console.error('[handleSoloBlackjackTimeout] No se pudo enviar el cierre:', error);
  }
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

    let betId;
    try {
      betId = await placeBet(player.id, apuesta, 'blackjack');
      await incrementBlackjackUsage(player.id, maxUsos);
    } catch (err) {
      console.error('[handleBlackjack] placeBet error:', err.message);
      const cancellationStatus = await cancelBlackjackBet(betId, apuesta, 'handleBlackjack');
      return buildBlackjackSetupFailure(cancellationStatus);
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

      try {
        await resolveBet(betId, finalPayout);
      } catch (err) {
        console.error('[handleBlackjack] resolveBet error:', err);
        return buildBlackjackSettlementPending([
          `Aventurero: *${player.username}*`,
          `Puntaje: jugador *${playerTotal}* · crupier *${dealerTotal}*`,
        ], finalPayout);
      }

      const newGold = await getBlackjackGoldWithFallback(
        sender,
        player.gold - apuesta + finalPayout,
        'handleBlackjack'
      );

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

    let replyMsg;
    try {
      replyMsg = await msg.reply(boardText);
    } catch (error) {
      console.error('[handleBlackjack] No se pudo enviar el tablero inicial:', error);
      const cancellationStatus = await cancelBlackjackBet(betId, apuesta, 'handleBlackjack.board');
      return buildBlackjackSetupFailure(cancellationStatus);
    }

    const session = {
      betId,
      isMultiplayer: false,
      playerId: player.id,
      playerPhone: sender,
      chatId: msg.from,
      username: player.username,
      startingGold: player.gold,
      bet: apuesta,
      playerCards,
      dealerCards,
      deck,
      maxUsos,
      currentUsos: currentUsos + 1,
      timeoutRef: null,
    };
    registerSoloSession(client, replyMsg.id._serialized, session);

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
  const mentionResolution = await resolveWhatsAppPhones(client, mentionedIds);
  if (mentionResolution.unresolved.length > 0) {
    return '❌ WhatsApp no permitió resolver uno de los jugadores mencionados. Vuelve a mencionarlo e intenta otra vez.';
  }
  for (const phone of mentionResolution.phones) {
    if (phone === normalizePhone(sender)) continue;
    if (participants.some(p => normalizePhone(p.phone) === phone)) continue;
    
    const player = await getPlayer(phone);
    if (!player) {
      return `❌ El jugador con teléfono *${phone}* no está registrado en el reino.`;
    }
    participants.push({
      player,
      phone,
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
      return `✅ Decision registrada para *${playerInSession.username}*: *${action}*.`;
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

    return `✅ Decision registrada para *${playerInSession.username}*: *${action}*.`;
  } else {
    // --- SOLO MODE REPLY FLOW ---
    const action = msg.body.trim().toLowerCase();

    if (action !== 'pedir' && action !== 'plantarse') {
      return `⚔️ Solo podés responder con *pedir* o *plantarse* en esta partida.`;
    }

    clearBlackjackSessionTimeout(session);
    activeSessions.delete(sessionId);

    if (action === 'pedir') {
      const newCard = session.deck.pop();
      session.playerCards.push(newCard);
      const playerTotal = calculateHand(session.playerCards);

      if (playerTotal > 21) {
        const dealerTotal = calculateHand(session.dealerCards);
        try {
          await resolveBet(session.betId, 0);
        } catch (err) {
          console.error('[handleBlackjackReply] resolveBet bust error:', err);
          await msg.reply(buildBlackjackSettlementPending([
            `Aventurero: *${session.username}*`,
            `Puntaje final: *${playerTotal}* · te pasaste de 21`,
          ], 0));
          return null;
        }
        const currentGold = await getBlackjackGoldWithFallback(
          session.playerPhone,
          Math.max(0, Number(session.startingGold ?? 0) - session.bet),
          'handleBlackjackReply'
        );

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

      let replyMsg;
      try {
        replyMsg = await msg.reply(updatedBoard);
      } catch (error) {
        session.playerCards.pop();
        session.deck.push(newCard);
        registerSoloSession(client, sessionId, session);
        throw error;
      }
      registerSoloSession(client, replyMsg.id._serialized, session);
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

  try {
    await resolveBet(session.betId, payout);
  } catch (err) {
    console.error('[runDealerTurn] resolveBet error:', err.message);
    await msg.reply(buildBlackjackSettlementPending([
      `Aventurero: *${session.username}*`,
      `Puntaje: jugador *${playerTotal}* · crupier *${dealerTotal}*`,
    ], payout));
    return;
  }

  const fallbackGold = Number.isFinite(Number(session.startingGold))
    ? Number(session.startingGold) - session.bet + payout
    : 0;
  const currentGold = await getBlackjackGoldWithFallback(
    session.playerPhone,
    Math.max(0, fallbackGold),
    'runDealerTurn'
  );

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
    await client.sendMessage(groupChatId, decorateCommandReply('21', '❌ No hay suficientes jugadores para iniciar el Blackjack PvP.'));
    return;
  }

  // Deduct gold and setup
  const finalPlayers = [];
  for (const p of accepted) {
    const dbPlayer = await getPlayer(p.playerPhone);
    const currentUsos = await getBlackjackUsage(p.playerId);
    if (!dbPlayer || dbPlayer.gold < session.bet || currentUsos >= 5) {
      await client.sendMessage(groupChatId, decorateCommandReply('21', `⚠️ *${p.username}* fue excluido porque no tiene oro suficiente o alcanzó el límite de usos.`));
      continue;
    }
    
    try {
      p.betId = await placeBet(p.playerId, session.bet, 'blackjack_pvp');
      await incrementBlackjackUsage(p.playerId, 5);
    } catch (err) {
      console.error(`[startMultiplayerGame] placeBet/incrementUsage error for ${p.username}:`, err);
      const cancellationStatus = await cancelBlackjackBet(
        p.betId,
        session.bet,
        `startMultiplayerGame.${p.username}`
      );
      const cancellationText = cancellationStatus === 'refunded'
        ? `⚠️ La apuesta de *${p.username}* fue cancelada y reembolsada; quedo fuera de la ronda.`
        : `⚠️ La apuesta de *${p.username}* no pudo confirmarse; cualquier retencion queda en custodia y quedo fuera de la ronda.`;
      await client.sendMessage(groupChatId, decorateCommandReply('21', cancellationText));
      continue;
    }
    
    p.status = 'playing';
    p.responseReceived = false;
    p.lastAction = null;
    finalPlayers.push(p);
  }

  if (finalPlayers.length < 2) {
    const pendingRefunds = await refundBlackjackPlayers(
      finalPlayers,
      session.bet,
      'startMultiplayerGame.insufficientPlayers'
    );
    const cancellationMessage = pendingRefunds.length > 0
      ? `⚠️ No hay suficientes jugadores validos. No se pudo confirmar el reembolso de *${pendingRefunds.join(', ')}*; su apuesta permanece en custodia.`
      : '❌ No hay suficientes jugadores validos para iniciar la partida. Reembolso emitido.';
    await client.sendMessage(groupChatId, decorateCommandReply('21', cancellationMessage));
    return;
  }

  session.players = finalPlayers;
  session.deck = shuffle(createDeck());
  for (const p of session.players) {
    p.cards = [session.deck.pop()];
  }
  session.state = 'playing';

  const boardText = formatMultiplayerBoard(session);
  let replyMsg;
  try {
    replyMsg = await client.sendMessage(groupChatId, boardText);
  } catch (error) {
    console.error('[startMultiplayerGame] No se pudo enviar el tablero:', error);
    const pendingRefunds = await refundBlackjackPlayers(
      finalPlayers,
      session.bet,
      'startMultiplayerGame.board'
    );
    const cancellationText = pendingRefunds.length > 0
      ? `⚠️ La partida no pudo iniciar. Reembolso pendiente para *${pendingRefunds.join(', ')}*.`
      : '⚠️ La partida no pudo iniciar y todas las apuestas fueron reembolsadas.';
    try {
      await client.sendMessage(groupChatId, decorateCommandReply('21', cancellationText));
    } catch (notificationError) {
      console.error('[startMultiplayerGame] No se pudo notificar la cancelacion:', notificationError);
    }
    return;
  }
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
    let replyMsg;
    try {
      replyMsg = await client.sendMessage(groupChatId, boardText);
    } catch (error) {
      console.error('[resolveMultiplayerRound] No se pudo enviar el siguiente tablero:', error);
      const pendingRefunds = await refundBlackjackPlayers(
        session.players,
        session.bet,
        'resolveMultiplayerRound.board'
      );
      const cancellationText = pendingRefunds.length > 0
        ? `⚠️ La partida fue cancelada. Reembolso pendiente para *${pendingRefunds.join(', ')}*.`
        : '⚠️ La partida fue cancelada y todas las apuestas fueron reembolsadas.';
      try {
        await client.sendMessage(groupChatId, decorateCommandReply('21', cancellationText));
      } catch (notificationError) {
        console.error('[resolveMultiplayerRound] No se pudo notificar la cancelacion:', notificationError);
      }
      return;
    }
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
  const pendingSettlements = new Set();

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

      let settled = true;
      try {
        await resolveBet(w.betId, payout);
      } catch (err) {
        console.error(`[finishMultiplayerGame] resolveBet error for ${w.username}:`, err.message);
        settled = false;
        pendingSettlements.add(w.username);
      }

      const newGold = settled
        ? await getBlackjackGoldWithFallback(w.playerPhone, null, `finishMultiplayerGame.${w.username}`)
        : null;
      results.push(settled
        ? `🏆 *${w.username}* gana *${payout.toLocaleString('es-PY')} oro*${newGold === null ? '' : ` (Total: ${newGold.toLocaleString('es-PY')} 🪙)`}`
        : `⚠️ *${w.username}* obtuvo la mano ganadora, pero su pago no pudo confirmarse.`);
    }

    // Resolve losers with 0 payout
    const losers = session.players.filter(p => !winners.includes(p));
    for (const l of losers) {
      try {
        await resolveBet(l.betId, 0);
      } catch (err) {
        console.error(`[finishMultiplayerGame] resolveBet error for loser ${l.username}:`, err.message);
        pendingSettlements.add(l.username);
      }
    }

    lines.push(results.join('\n'));
  } else {
    // Everyone lost
    for (const p of session.players) {
      try {
        await resolveBet(p.betId, 0);
      } catch (err) {
        console.error(`[finishMultiplayerGame] resolveBet error for ${p.username}:`, err.message);
        pendingSettlements.add(p.username);
      }
    }
    lines.push(`💀 *¡Todos se pasaron de 21!* La casa se queda con el pozo.`);
  }

  if (pendingSettlements.size > 0) {
    lines.push(
      `⚠️ *Liquidacion pendiente:* ${[...pendingSettlements].join(', ')}.`,
      'Las apuestas sin confirmar permanecen en custodia y seran reembolsadas si continúan pendientes.'
    );
  }

  const finalCard = heraldCard('21 (Blackjack PvP) - Fin de Partida', lines, { icon: '🏆' });
  await client.sendMessage(groupChatId, finalCard);
}
