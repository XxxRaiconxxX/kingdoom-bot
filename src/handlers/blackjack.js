import { getPlayer, updateGold, getBlackjackUsage, incrementBlackjackUsage } from '../supabase.js';
import { heraldCard, heraldStat } from '../formatting.js';

// Memory store for active blackjack sessions.
// Key: botMsgId (quoted message ID)
// Value: { playerId, playerPhone, username, bet, deck, playerCards, dealerCards }
export const activeSessions = new Map();

// Helper to check if a user already has an active session.
function getActiveSessionByPlayerId(playerId) {
  for (const [msgId, session] of activeSessions.entries()) {
    if (session.playerId === playerId) {
      return { msgId, session };
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

// Handle starting a game with `!21 <apuesta>`
export async function handleBlackjack(msg) {
  const parts = msg.body.split(' ');
  const apuesta = parseInt(parts[1], 10);
  const sender = msg.author || msg.from;
  const player = await getPlayer(sender);

  if (!player) return `⚔️ No estás registrado. Escribí *!registrar TuNombre*`;
  if (!apuesta || isNaN(apuesta) || apuesta < 10) return `🃏 Usá: *!21 100* (mínimo 10 oro)`;
  if (apuesta > player.gold) return `❌ No tenés suficiente oro.\n🪙 Tenés: ${player.gold.toLocaleString('es-PY')}`;

  // Check if player has an active session
  const existing = getActiveSessionByPlayerId(player.id);
  if (existing) {
    return `❌ Ya tenés una partida de Blackjack activa en curso. Respondé a ese mensaje para continuar.`;
  }

  // Weekday vs Weekend limits
  const dayOfWeek = new Date().getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  const maxUsos = isWeekend ? 5 : 3;
  const maxApuesta = isWeekend ? 500000 : 100000;

  if (apuesta > maxApuesta) {
    return `🃏 La apuesta máxima de Blackjack por ronda es de *${maxApuesta.toLocaleString('es-PY')} oro*${isWeekend ? ' durante el fin de semana' : ''}.`;
  }

  const currentUsos = await getBlackjackUsage(player.id);
  if (currentUsos >= maxUsos) {
    return `🃏 Alcanzaste el límite diario de Blackjack (${maxUsos}/${maxUsos}). ¡Volvé mañana para probar tu suerte!`;
  }

  // Deduct bet from DB immediately and increment usage
  try {
    await updateGold(player.id, -apuesta);
    await incrementBlackjackUsage(player.id);
  } catch (err) {
    console.error('[handleBlackjack] updateGold error:', err.message);
    return `⚔️ Error al registrar la apuesta. Intentá de nuevo.`;
  }

  // Prepare deck and hands
  const deck = shuffle(createDeck());
  const playerCards = [deck.pop(), deck.pop()];
  const dealerCards = [deck.pop(), deck.pop()];

  const playerTotal = calculateHand(playerCards);
  const dealerTotal = calculateHand(dealerCards);

  // Check for Natural Blackjack
  const playerHasNatural = playerTotal === 21;
  const dealerHasNatural = dealerTotal === 21;

  if (playerHasNatural || dealerHasNatural) {
    let outcomeText = '';
    let finalPayout = 0;
    
    if (playerHasNatural && dealerHasNatural) {
      finalPayout = apuesta; // Refund
      outcomeText = `⚖️ *¡Empate Natural!* Ambos tienen Blackjack.\nReembolso de *${apuesta.toLocaleString('es-PY')} oro*.`;
    } else if (playerHasNatural) {
      finalPayout = Math.floor(apuesta * 2.5); // 2.5x payout
      outcomeText = `✨ *¡Blackjack Natural!* ¡Ganaste!\nRecibís *${finalPayout.toLocaleString('es-PY')} oro* (2.5x).`;
    } else {
      finalPayout = 0; // Lost
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

  // Normal game starts, wait for reply
  // Send the board first, then save the message ID into the session store.
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

  return null; // Return null since we replied directly and registered the session
}

// Handle reply message directed at an active blackjack game message
export async function handleBlackjackReply(msg, session, sessionId) {
  const sender = msg.author || msg.from;
  const action = msg.body.trim().toLowerCase();

  if (action !== 'pedir' && action !== 'plantarse') {
    // Reply back with instructions but keep the session alive under the same ID
    return `⚔️ Solo podés responder con *pedir* o *plantarse* en esta partida.`;
  }

  // Remove the old session ID immediately to prevent duplicate requests or race conditions
  activeSessions.delete(sessionId);

  if (action === 'pedir') {
    // Draw a card
    const newCard = session.deck.pop();
    session.playerCards.push(newCard);
    const playerTotal = calculateHand(session.playerCards);

    if (playerTotal > 21) {
      // Player busted (se pasó)
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
      return;
    }

    if (playerTotal === 21) {
      // Auto-stand! Proceed immediately to dealer's turn
      await runDealerTurn(msg, session);
      return;
    }

    // Still playing, send the updated board and save session under new message ID
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
    return;
  }

  if (action === 'plantarse') {
    await runDealerTurn(msg, session);
    return;
  }
}

// Execute the dealer's drawing logic and resolve game payouts
async function runDealerTurn(msg, session) {
  let dealerTotal = calculateHand(session.dealerCards);

  // Crupier stands on 17 or higher
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
