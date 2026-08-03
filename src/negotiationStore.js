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
  const session = {
    ...data,
    expiresAt: Date.now() + NEGOTIATION_TTL_MS,
    createdAt: Date.now()
  };
  activeNegotiations.set(playerId, session);
  return session;
}

export function clearActiveNegotiation(playerId) {
  activeNegotiations.delete(playerId);
}
