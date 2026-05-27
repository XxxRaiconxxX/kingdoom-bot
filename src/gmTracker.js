import { getMissionByShortId } from './supabase.js';

const activeMissions = new Map();

/**
 * Initiates tracking for a mission.
 * @param {string} shortId - Up to 6 digits of the mission UUID
 * @param {number} maxParticipants - Wait for this many players
 */
export async function startMissionTracker(shortId, maxParticipants) {
  const mission = await getMissionByShortId(shortId);
  if (!mission) {
    return { success: false, message: `❌ Mision no encontrada con ID que empiece con: ${shortId}` };
  }

  const normalizedShortId = shortId.toUpperCase();
  activeMissions.set(normalizedShortId, {
    id: mission.id,
    shortId: normalizedShortId,
    title: mission.title,
    instructions: mission.instructions,
    maxParticipants: parseInt(maxParticipants, 10) || 1,
    participantsCounted: new Set(),
    context: [],
  });

  return { 
    success: true, 
    message: `✅ Misión *${mission.title}* [${normalizedShortId}] iniciada.\nEl bot Game Master esperará el rol de *${maxParticipants}* participantes antes de intervenir.`,
    mission 
  };
}

/**
 * Generates the system prompt using the Universal Prompt structure.
 */
export function buildGMPrompt(missionTitle, missionInstructions, context) {
  // Use the Prompt Universal structure exactly as defined by the user.
  const joinedContext = context.map(c => `Participante ${c.participantId}: ${c.text}`).join('\n\n');
  return `ERES EL GAME MASTER DEL REINO DE KINGDOOM.
MISION ACTUAL: ${missionTitle}
INSTRUCCIONES DE LA MISION / NPCS:
${missionInstructions}

ROLES DE LOS JUGADORES (CONTEXTO):
${joinedContext}

TU RESPUESTA DEBE SEGUIR ESTA NARRATIVA ORGÁNICA (NO uses títulos ni números como "1.", "2.", etc., haz que fluya como un libro):
- Abre la escena describiendo el entorno, olores y clima de forma inmersiva.
- Reacciona a cada jugador por su nombre. Separa la narrativa visual de las consecuencias mecánicas usando bloques de código (ejemplo: \`tu ataque impacta con 50 puntos de daño crítico\`).
- Los NPCs y Enemigos DEBEN actuar basándose ESTRICTAMENTE en la información provista en las INSTRUCCIONES DE LA MISION. Si la misión define sus niveles, estadísticas o habilidades, úsalas en la narración mecánica (ej: \`El Goblin (Lv 2) activa su habilidad de escape\`).
- Termina la intervención con un cierre tenso, dejando la escena en un punto crítico para que los jugadores reaccionen.
- Opcional: Al final puedes dejar un pequeño resumen de Tags/Estadísticas actualizadas.

Manten la coherencia. NO ROMPAS EL ROL. NO RESPONDAS COMO ASISTENTE SINO COMO NARRADOR OMNISCIENTE.`;
}

/**
 * Checks if a message belongs to a mission and tracks it.
 */
export function processTrackerMessage(text, participantId) {
  for (const [shortId, state] of activeMissions.entries()) {
    if (text.includes(shortId) || text.includes(`ID: ${shortId}`) || text.includes(`ID ${shortId}`)) {
      state.context.push({ participantId, text });
      state.participantsCounted.add(participantId);

      if (state.participantsCounted.size >= state.maxParticipants) {
        const contextToProcess = [...state.context];
        state.participantsCounted.clear();
        state.context = [];

        return {
          shouldTriggerGM: true,
          missionId: state.id,
          missionTitle: state.title,
          missionInstructions: state.instructions,
          context: contextToProcess,
          shortId
        };
      }
      return { 
        shouldTriggerGM: false, 
        counted: true, 
        current: state.participantsCounted.size, 
        required: state.maxParticipants,
        shortId
      };
    }
  }
  return null;
}
