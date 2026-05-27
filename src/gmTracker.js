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

TU RESPUESTA DEBE SEGUIR ESTRICTAMENTE ESTA ESTRUCTURA DE BLOQUES:
1. Apertura Sensorial: Describe el entorno, el clima, los olores y colores en 2-3 líneas muy inmersivas.
2. Resolucion Individual: Reacciona a lo que hizo cada participante. Nómbralos explícitamente y narra las consecuencias de sus actos de forma justa.
3. Reaccion NPC: Haz que los enemigos o personajes del entorno actúen. Deben hablar, atacar o defenderse. Usa cursiva para sus diálogos.
4. Cierre Tenso: Termina tu rol dejando la escena en un punto crítico (un cliffhanger o una nueva amenaza) para que los jugadores respondan.
5. Tags/Estadísticas: Añade etiquetas cortas al final si hubo cambios de HP, estados o eventos.

Manten la coherencia. DEBES COMPLETAR LOS 5 PUNTOS OBLIGATORIAMENTE. Asegúrate de generar una respuesta detallada y completa sin cortarte a la mitad. NO ROMPAS EL ROL. NO RESPONDAS COMO ASISTENTE SINO COMO NARRADOR OMNISCIENTE.`;
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
