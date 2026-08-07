import { normalizePhone } from './adminStore.js';

let activeColosseumMatch = null;
const colosseumHistory = [];

export function getActiveColosseumMatch() {
  return activeColosseumMatch;
}

export function createColosseumMatch(options = {}) {
  const {
    fighterA,
    fighterB,
    chatId,
    roleplayChatId = '120363024420812768@g.us',
    bettingDurationMs = 3 * 60 * 1000,
    combatIntervalMs = 60 * 1000,
  } = options;

  const id = `coliseo_${Date.now()}`;
  const now = Date.now();

  activeColosseumMatch = {
    id,
    status: 'betting', // 'betting' | 'fighting' | 'completed' | 'cancelled'
    fighterA,
    fighterB,
    chatId,
    roleplayChatId,
    announcementMsgId: null,
    fighterAMsgId: null,
    fighterBMsgId: null,
    createdAt: now,
    bettingClosesAt: now + bettingDurationMs,
    bettingDurationMs,
    combatIntervalMs,
    bets: [], // { playerPhone, username, target: 'A'|'B', fighterName, amount, odds, potentialPayout, placedAt }
    rounds: [],
    roundIndex: 0,
    winner: null,
    winnerFighter: null,
    settlement: null,
    timer: null,
  };

  return activeColosseumMatch;
}

export function setColosseumMessageIds(matchId, messageIds = {}) {
  if (!activeColosseumMatch || activeColosseumMatch.id !== matchId) {
    return null;
  }

  if (messageIds.announcementMsgId) activeColosseumMatch.announcementMsgId = messageIds.announcementMsgId;
  if (messageIds.fighterAMsgId) activeColosseumMatch.fighterAMsgId = messageIds.fighterAMsgId;
  if (messageIds.fighterBMsgId) activeColosseumMatch.fighterBMsgId = messageIds.fighterBMsgId;

  return activeColosseumMatch;
}

export function findColosseumBetTargetByQuotedId(quotedMsgId) {
  if (!activeColosseumMatch || !quotedMsgId) return null;
  const cleanQuoted = String(quotedMsgId._serialized || quotedMsgId || '').trim();

  const msgA = String(activeColosseumMatch.fighterAMsgId?._serialized || activeColosseumMatch.fighterAMsgId || '').trim();
  const msgB = String(activeColosseumMatch.fighterBMsgId?._serialized || activeColosseumMatch.fighterBMsgId || '').trim();

  if (cleanQuoted && cleanQuoted === msgA) return 'A';
  if (cleanQuoted && cleanQuoted === msgB) return 'B';
  return null;
}

export function recordColosseumBet(match, betData) {
  if (!match || match.status !== 'betting') {
    throw new Error('La ventana de apuestas del Coliseo ya esta cerrada.');
  }

  const phone = normalizePhone(betData.playerPhone);
  if (!phone) {
    throw new Error('Identificador de apostador no valido.');
  }

  // Prevent multiple opposing bets from the same player to avoid exploits
  const existing = match.bets.find((b) => normalizePhone(b.playerPhone) === phone);
  if (existing) {
    if (existing.target !== betData.target) {
      throw new Error(`Ya tienes una apuesta activa por ${existing.fighterName}. No puedes apostar por ambos bandos en el mismo duelo.`);
    }
    // Append to existing bet
    existing.amount += betData.amount;
    existing.potentialPayout = Math.round(existing.amount * existing.odds);
    return existing;
  }

  const fighter = betData.target === 'A' ? match.fighterA : match.fighterB;
  const odds = fighter.odds;
  const potentialPayout = Math.round(betData.amount * odds);

  const newBet = {
    playerPhone: phone,
    username: betData.username || 'Apostador Anónimo',
    target: betData.target, // 'A' or 'B'
    fighterName: fighter.fullName,
    amount: betData.amount,
    odds,
    potentialPayout,
    placedAt: Date.now(),
  };

  match.bets.push(newBet);
  return newBet;
}

export function closeColosseumBetting(match) {
  if (!match) return null;
  match.status = 'fighting';
  if (match.timer) {
    clearTimeout(match.timer);
    match.timer = null;
  }
  return match;
}

export function recordColosseumRound(match, roundLog) {
  if (!match) return;
  match.roundIndex += 1;
  match.rounds.push({
    roundNumber: match.roundIndex,
    ...roundLog,
    timestamp: Date.now(),
  });
}

export function resolveColosseumWinner(match, winnerTarget) {
  if (!match) return null;
  match.status = 'completed';
  match.winner = winnerTarget; // 'A' | 'B'
  match.winnerFighter = winnerTarget === 'A' ? match.fighterA : match.fighterB;

  const winners = [];
  const losers = [];
  let totalDistributedGold = 0;

  for (const bet of match.bets) {
    if (bet.target === winnerTarget) {
      winners.push(bet);
      totalDistributedGold += bet.potentialPayout;
    } else {
      losers.push(bet);
    }
  }

  match.settlement = {
    winnerTarget,
    winnerName: match.winnerFighter.fullName,
    winnerOdds: match.winnerFighter.odds,
    winnersCount: winners.length,
    losersCount: losers.length,
    totalDistributedGold,
    winners,
    losers,
    completedAt: Date.now(),
  };

  colosseumHistory.push(match);
  activeColosseumMatch = null;

  return match.settlement;
}

export function cancelColosseumMatch(match, reason = 'Cancelado por el arbitro') {
  if (!match) return null;
  if (match.timer) {
    clearTimeout(match.timer);
    match.timer = null;
  }
  match.status = 'cancelled';
  match.cancelReason = reason;

  const refundedBets = [...match.bets];
  activeColosseumMatch = null;
  return refundedBets;
}
