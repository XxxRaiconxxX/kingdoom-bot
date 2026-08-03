// Store temporal en memoria para negociaciones de negocios activas
// Cada negociación tiene una vigencia de 15 minutos.

const activeNegotiations = new Map();
const NEGOTIATION_TTL_MS = 15 * 60 * 1000; // 15 minutos

export function getActiveNegotiation(playerId) {
  const session = activeNegotiations.get(playerId);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    activeNegotiations.delete(playerId);
    return null;
  }

  return session;
}

export function setActiveNegotiation(playerId, data) {
  const existing = getActiveNegotiation(playerId);
  const session = {
    conversationHistory: existing?.conversationHistory || [],
    ...data,
    expiresAt: Date.now() + NEGOTIATION_TTL_MS,
    createdAt: existing?.createdAt || Date.now()
  };
  activeNegotiations.set(playerId, session);
  return session;
}

export function appendNegotiationHistory(playerId, role, content) {
  const session = getActiveNegotiation(playerId);
  if (!session) return;
  if (!Array.isArray(session.conversationHistory)) {
    session.conversationHistory = [];
  }
  session.conversationHistory.push({ role, content });
  // Limitar historial a los últimos 10 mensajes para ahorrar tokens
  if (session.conversationHistory.length > 10) {
    session.conversationHistory = session.conversationHistory.slice(-10);
  }
  activeNegotiations.set(playerId, session);
}

export function clearActiveNegotiation(playerId) {
  activeNegotiations.delete(playerId);
}
