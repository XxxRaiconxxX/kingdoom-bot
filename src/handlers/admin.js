import {
  supabase,
  updateGold,
  registerPlayer,
  getRealmCensus,
  getStaffSnapshot,
  getActivityReport,
  awardManualMissionRankPoints,
  getPlayersByPhone,
} from '../supabase.js';
import { isOwner, isAdminUser, isStaffUser, addAdmin, removeAdmin, normalizePhone } from '../adminStore.js';
import { trackUnregisteredUsers, saveTrackerData } from '../tracker.js';
import { recordAdminAction, getRecentAdminActions } from '../auditLog.js';
import { resolvePlayerTarget } from '../targetResolver.js';
import { heraldCard, heraldCommand, heraldList, heraldSection, heraldStat } from '../formatting.js';
import { buildWelcomeConfig } from './welcome.js';
import { startMissionTracker } from '../gmTracker.js';

async function getGroupPendingMembers(chat, client) {
  const { players, sheets } = await getRealmCensus();
  const groupParticipants = chat.participants;
  const registeredPhones = new Set();

  players.forEach((player) => {
    if (player.phone) {
      player.phone.split(',').forEach((p) => {
        const norm = normalizePhone(p.trim());
        if (norm) registeredPhones.add(norm);
      });
    }
  });

  const unregisteredMembers = [];
  const registeredWithoutPj = [];
  const mentions = [];

  for (const participant of groupParticipants) {
    const phone = normalizePhone(participant.id.user);
    const jid = participant.id._serialized;

    if (jid === client.info.wid._serialized) continue;

    if (!registeredPhones.has(phone)) {
      unregisteredMembers.push(participant);
      mentions.push(jid);
      continue;
    }

    const linkedPlayers = players.filter((player) => {
      if (!player.phone) return false;
      return player.phone.split(',').some((p) => normalizePhone(p.trim()) === phone);
    });
    const hasAnySheet = linkedPlayers.some((player) =>
      sheets.some((sheet) => {
        const sheetPlayerId = String(sheet.playerId || sheet.player_id || '').trim();
        return sheetPlayerId === String(player.id).trim();
      })
    );

    if (!hasAnySheet && linkedPlayers.length > 0) {
      registeredWithoutPj.push({ player: linkedPlayers[0], participant });
      mentions.push(jid);
    }
  }

  return {
    groupParticipants,
    unregisteredMembers,
    registeredWithoutPj,
    mentions,
    allPendingPhones: [
      ...unregisteredMembers.map((member) => normalizePhone(member.id.user)),
      ...registeredWithoutPj.map((member) => normalizePhone(member.participant.id.user)),
    ],
  };
}

const MISSION_POINT_DIFFICULTIES = new Map([
  ['easy', 'easy'],
  ['facil', 'easy'],
  ['fácil', 'easy'],
  ['medium', 'medium'],
  ['media', 'medium'],
  ['medio', 'medium'],
  ['hard', 'hard'],
  ['dificil', 'hard'],
  ['difícil', 'hard'],
]);

function normalizeMissionDifficulty(value) {
  const key = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return MISSION_POINT_DIFFICULTIES.get(key) ?? '';
}

function getMessageSerializedId(msg) {
  return msg?.id?._serialized || msg?.id?.id || '';
}

async function getActorPrivileges(sender) {
  const actorPhone = normalizePhone(sender);
  const isSenderOwner = isOwner(sender);
  const listedAdmin = isAdminUser(sender);
  const listedStaff = isStaffUser(sender);
  const actorPlayers = await getPlayersByPhone(sender);
  const dbAdmin = actorPlayers.some((player) => player?.is_admin === true);
  const actorName = actorPlayers[0]?.username ?? 'Staff';

  return {
    actorPhone,
    actorName,
    isSenderOwner,
    isAdmin: isSenderOwner || listedAdmin || dbAdmin,
    isStaff: listedStaff,
  };
}

async function resolveMissionCompletionTargets(msg) {
  const uniquePhones = [...new Set((msg?.mentionedIds ?? []).map((entry) => normalizePhone(entry)).filter(Boolean))];
  const resolvedTargets = [];
  const unresolved = [];
  const ambiguous = [];

  for (const phone of uniquePhones) {
    const players = await getPlayersByPhone(phone);
    if (!players.length) {
      unresolved.push(phone);
      continue;
    }
    if (players.length > 1) {
      ambiguous.push(phone);
      continue;
    }

    resolvedTargets.push({
      phone,
      player: players[0],
    });
  }

  return {
    resolvedTargets,
    unresolved,
    ambiguous,
  };
}

export async function handleAdminCommand(msg, client) {
  const text = msg.body.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const sender = msg.author || msg.from;
  const {
    actorPhone,
    actorName,
    isSenderOwner,
    isAdmin,
    isStaff,
  } = await getActorPrivileges(sender);
  const isPrivileged = isAdmin || isStaff;

  // Helper function to extract number from input (remove @c.us if present, only digits)
  const extractPhone = (input) => {
    if (!input) return '';
    return input.replace('@c.us', '').replace(/\D/g, '').trim();
  };
  const isLikelyPhone = (input) => {
    const digits = extractPhone(input);
    return digits.length >= 8;
  };

  const describeResolutionError = (identifier, result) => {
    if (result?.reason === 'ambiguous') {
      return `⚠️ Hay varias coincidencias para *${identifier}*. Usa el celular, cita el mensaje, menciona al jugador o pasa un ID más largo.`;
    }
    return `❌ Jugador *${identifier || 'desconocido'}* no encontrado en el reino.`;
  };

  // 0. Menu command !admin
  if (cmd === '!admin') {
    if (isSenderOwner) {
      return heraldCard('Menu del soberano', [
        heraldSection('Altas y control'),
        heraldList([
          heraldCommand('!registrar <nombre> [oro]', 'Registra respondiendo a un mensaje.'),
          heraldCommand('!registrar <celular> <nombre> [oro]', 'Registro manual directo.'),
          heraldCommand('!add admin <objetivo>', 'Otorga admin.'),
          heraldCommand('!remove admin <objetivo>', 'Revoca admin.'),
          heraldCommand('!ban <objetivo>', 'Destierra un jugador.'),
        ]),
        heraldSection('Economia y revision'),
        heraldList([
          heraldCommand('!grant <objetivo> <monto>', 'Entrega oro.'),
          heraldCommand('!quitar <objetivo> <monto>', 'Descuenta oro.'),
          heraldCommand('!forjaritem <idea> [url]', 'Forja un borrador IA para el mercado.'),
          heraldCommand('!censo', 'Censo general del reino.'),
          heraldCommand('!pendientes', 'No vinculados y sin ficha.'),
          heraldCommand('!purga', 'Expulsa pendientes de mas de 3 dias.'),
          heraldCommand('!grupos', 'Lista grupos y sus IDs.'),
          heraldCommand('!grupoactual', 'Estado del grupo donde escribes.'),
          heraldCommand('!staff', 'Resumen operativo.'),
          heraldCommand('!bitacora', 'Ultimas acciones.'),
          heraldCommand('!groupid', 'ID tecnico del grupo.'),
          heraldCommand('!stats', 'Resumen general del reino.'),
          heraldCommand('!misionstart <ID> <Jugadores>', 'Inicia el bot Game Master para una mision.'),
        ]),
      ], { icon: '👑' });
    } else {
      return heraldCard('Menu de administrador', [
        heraldSection('Operaciones'),
        heraldList([
          heraldCommand('!registrar <nombre> [oro]', 'Registra respondiendo a un mensaje.'),
          heraldCommand('!registrar <celular> <nombre> [oro]', 'Registro manual directo.'),
          heraldCommand('!grant <objetivo> <monto>', 'Entrega oro.'),
          heraldCommand('!quitar <objetivo> <monto>', 'Descuenta oro.'),
          heraldCommand('!forjaritem <idea> [url]', 'Forja un borrador IA para el mercado.'),
          heraldCommand('!ban <objetivo>', 'Destierra un jugador.'),
        ]),
        heraldSection('Revision'),
        heraldList([
          heraldCommand('!censo', 'Censo general del reino.'),
          heraldCommand('!pendientes', 'No vinculados y sin ficha.'),
          heraldCommand('!purga', 'Expulsa pendientes de mas de 3 dias.'),
          heraldCommand('!actividad', 'Reporte de inactividad.'),
          heraldCommand('!staff', 'Resumen operativo.'),
          heraldCommand('!bitacora', 'Ultimas acciones.'),
          heraldCommand('!groupid', 'ID tecnico del grupo.'),
          heraldCommand('!stats', 'Resumen general del reino.'),
          heraldCommand('!misionstart <ID> <Jugadores>', 'Inicia el bot Game Master para una mision.'),
        ]),
      ], { icon: '🛡️' });
    }
  }

  if (cmd === '!misioncompleta') {
    if (!isPrivileged) {
      return '❌ Solo el staff o los administradores pueden otorgar puntos de misión.';
    }

    const difficulty = normalizeMissionDifficulty(parts[1]);
    if (!difficulty) {
      return '❌ Uso: *!misioncompleta <easy|medium|hard> <@jugadores>*';
    }

    if (!Array.isArray(msg.mentionedIds) || msg.mentionedIds.length === 0) {
      return '❌ Debes mencionar al menos a un jugador. Ejemplo: *!misioncompleta easy @jugador1 @jugador2*';
    }

    const messageId = getMessageSerializedId(msg);
    if (!messageId) {
      return '❌ No pude obtener el identificador del mensaje para blindar la entrega. Repite el comando.';
    }

    const { resolvedTargets, unresolved, ambiguous } = await resolveMissionCompletionTargets(msg);
    if (!resolvedTargets.length) {
      return '❌ Ninguna de las menciones corresponde a un jugador vinculado en la base de datos.';
    }
    if (unresolved.length || ambiguous.length) {
      const detail = [
        unresolved.length ? `Sin vínculo: ${unresolved.map((phone) => `+${phone}`).join(', ')}` : '',
        ambiguous.length ? `Múltiples perfiles vinculados: ${ambiguous.map((phone) => `+${phone}`).join(', ')}` : '',
      ].filter(Boolean).join('\n');
      return `❌ El reparto se canceló para evitar asignaciones incorrectas.\n${detail}`;
    }

    const uniquePlayerIds = [...new Set(resolvedTargets.map((entry) => entry.player.id))];
    const externalRef = `mission-complete:${msg.from}:${messageId}`;
    const targetNames = resolvedTargets.map((entry) => entry.player.username);
    const notes = `WhatsApp !misioncompleta ${difficulty} | chat ${msg.from} | targets: ${targetNames.join(', ')}`;

    try {
      const result = await awardManualMissionRankPoints({
        playerIds: uniquePlayerIds,
        difficulty,
        awardedByName: actorName,
        awardedByPhone: actorPhone,
        notes,
        externalRef,
      });

      const pointsPerPlayer = Number(result?.points_per_player ?? 0);
      const awardedPlayers = Number(result?.awarded_players ?? uniquePlayerIds.length);
      const seasonName = result?.season_name ?? 'Temporada activa';

      recordAdminAction({
        actorPhone,
        actorName,
        action: 'mission_complete_points',
        target: targetNames.join(', '),
        detail: `Dificultad ${difficulty}. ${pointsPerPlayer} pts por jugador. Ref ${externalRef}.`,
        chatId: msg.from,
      });

      return `🏅 *Puntos de misión otorgados*\nTemporada: *${seasonName}*\nDificultad: *${difficulty.toUpperCase()}* — *${pointsPerPlayer} pts* por jugador\nAventureros: *${targetNames.join(', ')}*\nAplicados: *${awardedPlayers}*`;
    } catch (error) {
      const rawMessage = String(error?.message ?? error);
      const duplicateLike =
        rawMessage.includes('duplicate key value') ||
        rawMessage.includes('idx_season_rank_awards_external_ref');

      if (duplicateLike) {
        return '⚠️ Este mensaje ya fue procesado antes. El blindaje impidió otorgar puntos duplicados.';
      }

      console.error('[admin misioncompleta]', error);
      return `❌ No se pudieron otorgar los puntos de misión. Motivo: ${rawMessage}`;
    }
  }

  // Mision Tracker
  if (cmd === '!misionstart') {
    const shortId = parts[1];
    const maxParticipants = parts[2] || 1;

    if (!shortId) {
      return '❌ Uso: *!misionstart <ID (6 caracteres)> <cantidad de participantes>*';
    }

    const result = await startMissionTracker(shortId, maxParticipants);
    return result.message;
  }

  // 1. !add admin <nombre/celular> (Owner only!)
  if (cmd === '!add' && parts[1]?.toLowerCase() === 'admin') {
    if (!isSenderOwner) {
      return `❌ Solo el Soberano del Reino puede otorgar funciones administrativas.`;
    }
    let identifier = '';
    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      identifier = extractPhone(quoted.author || quoted.from);
    } else {
      identifier = parts.slice(2).join(' ').trim();
    }

    if (!identifier) {
      return `❌ Uso correcto: *!add admin <ID/nombre/celular>* o responde a un mensaje.`;
    }

    const resolved = await resolvePlayerTarget(msg, identifier);
    if (!resolved.ok) return describeResolutionError(identifier, resolved);

    const targetPhone = resolved.player.phone || resolved.phone;
    const targetName = resolved.player.username;

    const success = addAdmin(targetPhone);
    if (success && resolved.player) {
      await supabase.from('players').update({ is_admin: true }).eq('id', resolved.player.id);
    }
    if (success) {
      recordAdminAction({
        actorPhone,
        actorName,
        action: 'add_admin',
        target: `${targetName} (${targetPhone})`,
        detail: `Otorgó admin por ${resolved.matchType || resolved.source || 'resolucion directa'}.`,
        chatId: msg.from,
      });
    }
    return success 
      ? `👑 *Soberanía concedida:* *${targetName}* ahora es Administrador del Reino.`
      : `❌ Error al guardar la lista de administradores.`;
  }

  // 2. !remove admin <ID/nombre/celular> (Owner only!)
  if (cmd === '!remove' && parts[1]?.toLowerCase() === 'admin') {
    if (!isSenderOwner) {
      return `❌ Solo el Soberano del Reino puede revocar funciones administrativas.`;
    }
    let identifier = '';
    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      identifier = extractPhone(quoted.author || quoted.from);
    } else {
      identifier = parts.slice(2).join(' ').trim();
    }

    if (!identifier) {
      return `❌ Uso correcto: *!remove admin <ID/nombre/celular>* o responde a un mensaje.`;
    }

    const resolved = await resolvePlayerTarget(msg, identifier);
    if (!resolved.ok) return describeResolutionError(identifier, resolved);

    const targetPhone = resolved.player.phone || resolved.phone;
    const targetName = resolved.player.username;

    const success = removeAdmin(targetPhone);
    if (success && resolved.player) {
      await supabase.from('players').update({ is_admin: false }).eq('id', resolved.player.id);
    }
    if (success) {
      recordAdminAction({
        actorPhone,
        actorName,
        action: 'remove_admin',
        target: `${targetName} (${targetPhone})`,
        detail: `Revocó admin por ${resolved.matchType || resolved.source || 'resolucion directa'}.`,
        chatId: msg.from,
      });
    }
    return success 
      ? `🛡️ *Soberanía revocada:* *${targetName}* ha dejado de ser Administrador.`
      : `❌ Error al guardar la lista de administradores.`;
  }

  // 3. !registrar
  if (cmd === '!registrar') {
    let targetPhone = '';
    let username = '';
    let goldAmount = 2500;

    if (msg.hasQuotedMsg) {
      // Caso 1: Respondiendo a un mensaje -> !registrar <nombre> [oro]
      const quoted = await msg.getQuotedMessage();
      targetPhone = quoted.author || quoted.from;
      
      username = parts[1];
      if (parts[2]) {
        const parsedGold = parseInt(parts[2].replace(/\./g, ''));
        if (!isNaN(parsedGold)) goldAmount = parsedGold;
      }
    } else {
      // Caso 2: Sin responder -> !registrar <celular> <nombre> [oro]
      if (parts.length < 3) {
        return `*Error de registro:*\n` +
               `*Opcion A (Copiado/Respondiendo):* Cita el mensaje del jugador con: \`!registrar <nombre> [oro]\`\n` +
               `*Opcion B (Directo/Manual):* Escribe de forma directa: \`!registrar <celular> <nombre> [oro]\``;
      }
      if (!isLikelyPhone(parts[1])) {
        return `*Registro cancelado por formato invalido.*\n` +
               `Parece que intentaste usar \`!registrar <nombre> [oro]\` sin citar el mensaje del jugador.\n` +
               `*Opcion A:* responde al mensaje del jugador con \`!registrar <nombre> [oro]\`\n` +
               `*Opcion B:* usa el formato manual \`!registrar <celular> <nombre> [oro]\``;
      }
      targetPhone = parts[1];
      username = parts[2];
      if (parts[3]) {
        const parsedGold = parseInt(parts[3].replace(/\./g, ''));
        if (!isNaN(parsedGold)) goldAmount = parsedGold;
      }
    }

    // Validaciones
    if (!targetPhone) {
      return `❌ *Error de registro:*\n` +
             `Usa respondiendo a un mensaje: *!registrar <nombre> [oro]*\n` +
             `O de forma directa: *!registrar <celular> <nombre> [oro]*`;
    }

    const cleanPhone = extractPhone(targetPhone);
    if (!cleanPhone || isNaN(Number(cleanPhone)) || cleanPhone.length < 8) {
      return `❌ Número de celular no válido.`;
    }

    if (!username || username.trim().length < 2) {
      return `❌ Especifica un nombre de usuario válido de al menos 2 caracteres.`;
    }

    // Ejecutar registro
    try {
      const result = await registerPlayer(`${cleanPhone}@c.us`, username.trim(), goldAmount);
      if (result.startsWith('✅')) {
        recordAdminAction({
          actorPhone,
          actorName,
          action: 'registrar',
          target: `${username.trim()} (${cleanPhone})`,
          detail: `Registro manual con ${goldAmount.toLocaleString('es-PY')} oro inicial.`,
          chatId: msg.from,
        });
      }
      return result;
    } catch (err) {
      console.error('[admin registrar]', err);
      return `❌ Error al registrar en Supabase: ${err.message}`;
    }
  }

  // 3.5 !verificarnumero
  if (cmd === '!verificarnumero') {
    let targetPhone = '';
    let identifier = '';
    
    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      targetPhone = quoted.author || quoted.from;
      identifier = parts.slice(1).join(' ').trim();
    } else {
      targetPhone = parts[1];
      identifier = parts.slice(2).join(' ').trim();
    }

    if (!targetPhone || !identifier) {
      return `❌ *Uso correcto:*\n` +
             `*Opción A (Respondiendo):* Cita un mensaje con \`!verificarnumero <perfil/ID>\`\n` +
             `*Opción B (Manual):* \`!verificarnumero <número> <perfil/ID>\``;
    }

    const cleanPhone = normalizePhone(targetPhone);
    if (!cleanPhone) {
      return `❌ Número de celular no válido.`;
    }

    const resolved = await resolvePlayerTarget(msg, identifier);
    if (!resolved.ok) return describeResolutionError(identifier, resolved);

    let newPhone = cleanPhone;
    if (resolved.player.phone) {
      const existingPhones = resolved.player.phone.split(',').map(p => p.trim());
      if (!existingPhones.includes(cleanPhone)) {
        newPhone = `${resolved.player.phone},${cleanPhone}`;
      } else {
        return `✅ El número ${cleanPhone} ya estaba vinculado a *${resolved.player.username}*.`;
      }
    }

    const { error } = await supabase
      .from('players')
      .update({ phone: newPhone })
      .eq('id', resolved.player.id);

    if (error) {
      console.error('[admin verificarnumero]', error);
      return `❌ Error al vincular en Supabase: ${error.message}`;
    }

    recordAdminAction({
      actorPhone,
      actorName,
      action: 'verificarnumero',
      target: `${resolved.player.username} (${cleanPhone})`,
      detail: `Vinculación forzada de número por ${resolved.matchType || resolved.source}.`,
      chatId: msg.from,
    });

    return `✅ ¡Vinculación forzada exitosa!\n\n🛡️ El aventurero *${resolved.player.username}* ahora está vinculado también al número ${cleanPhone}.`;
  }

  // 3.6 !desvincular
  if (cmd === '!desvincular') {
    const identifier = parts.slice(1).join(' ').trim();
    if (!identifier) {
      return `❌ *Uso correcto:* \`!desvincular <perfil_o_ID>\``;
    }

    const resolved = await resolvePlayerTarget(msg, identifier);
    if (!resolved.ok) return describeResolutionError(identifier, resolved);

    if (!resolved.player.phone) {
      return `⚠️ El aventurero *${resolved.player.username}* no tiene ningún número telefónico vinculado actualmente.`;
    }

    const oldPhone = resolved.player.phone;

    const { error } = await supabase
      .from('players')
      .update({ phone: null })
      .eq('id', resolved.player.id);

    if (error) {
      console.error('[admin desvincular]', error);
      return `❌ Error al desvincular en Supabase: ${error.message}`;
    }

    recordAdminAction({
      actorPhone,
      actorName,
      action: 'desvincular',
      target: `${resolved.player.username}`,
      detail: `Se desvinculó de los números: ${oldPhone}`,
      chatId: msg.from,
    });

    return `✂️ Se ha desvinculado exitosamente a *${resolved.player.username}* de sus números telefónicos (${oldPhone}).`;
  }


  // 4. !grant y !quitar
  if (cmd === '!grant' || cmd === '!quitar') {
    let identifier = '';
    let amount = 0;

    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      identifier = extractPhone(quoted.author || quoted.from);
      amount = parseInt(String(parts[1] ?? '').replace(/\./g, ''));
    } else {
      amount = parseInt(String(parts[parts.length - 1] ?? '').replace(/\./g, ''));
      identifier = parts.slice(1, -1).join(' ').trim();
    }

    if (!identifier || isNaN(amount) || amount === 0) {
      return `❌ *Uso correcto:*\n` +
             `*Respondiendo:* \`${cmd} <monto>\`\n` +
             `*Directo:* \`${cmd} <ID/nombre/celular> <monto>\``;
    }

    let finalAmount = Math.abs(amount);
    if (cmd === '!quitar') {
      finalAmount = -finalAmount;
    } else if (cmd === '!grant' && amount < 0) {
      finalAmount = amount; // Permite !grant -100 por si acaso
    }

    const resolved = await resolvePlayerTarget(msg, identifier);
    if (!resolved.ok) return describeResolutionError(identifier, resolved);

    const { player } = resolved;

    try {
      await updateGold(player.id, finalAmount);
      // Re-fetch para tener el saldo real
      const { data: updated } = await supabase.from('players').select('gold').eq('id', player.id).maybeSingle();
      const newTotal = updated?.gold ?? (player.gold + finalAmount);
      const action = finalAmount > 0 ? `+${finalAmount.toLocaleString('es-PY')}` : `${finalAmount.toLocaleString('es-PY')}`;
      recordAdminAction({
        actorPhone,
        actorName,
        action: finalAmount > 0 ? 'grant_gold' : 'remove_gold',
        target: `${player.username} (${player.phone || resolved.phone || 'sin telefono'})`,
        detail: `${action} oro. Nuevo total: ${newTotal.toLocaleString('es-PY')}.`,
        chatId: msg.from,
      });
      return `✅ *${action} oro* aplicado a *${player.username}*\n🪙 Nuevo total: ${newTotal.toLocaleString('es-PY')}`;
    } catch {
      return `❌ Error al actualizar el oro.`;
    }
  }



  // 6. !stats
  if (cmd === '!stats') {
    const { count: totalPlayers } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });

    const { data: richest } = await supabase
      .from('players')
      .select('username, gold')
      .order('gold', { ascending: false })
      .limit(1)
      .maybeSingle();

    return heraldCard('Stats del reino', [
      heraldStat('Jugadores', totalPlayers),
      heraldStat('Mas rico', `${richest?.username ?? '—'} (${(richest?.gold ?? 0).toLocaleString('es-PY')} oro)`),
    ], { icon: '📊' });
  }

  if (cmd === '!staff') {
    const snapshot = await getStaffSnapshot();
    const richest = snapshot.richestPlayers
      .map((entry, index) => `${index + 1}. ${entry.username} (${Number(entry.gold ?? 0).toLocaleString('es-PY')})`)
      .join('\n');

    return heraldCard('Resumen de staff', [
      heraldStat('Jugadores', snapshot.totalPlayers),
      heraldStat('Vinculados', snapshot.linkedPlayers),
      heraldStat('Fichas', snapshot.totalSheets),
      heraldStat('Misiones abiertas', snapshot.openMissions),
      heraldStat('Eventos activos', snapshot.activeEvents),
      heraldSection('Top oro'),
      richest || 'Sin datos.',
    ], { icon: '🧾' });
  }

  // 7. !ban o !eliminar
  if (cmd === '!ban' || cmd === '!eliminar' || cmd === '!kick') {
    let identifier = '';
    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      identifier = extractPhone(quoted.author || quoted.from);
    } else {
      identifier = parts.slice(1).join(' ').trim();
    }

    if (!identifier) {
      return `❌ *Uso correcto de !ban/!eliminar:*\n` +
             `*Respondiendo:* \`${cmd}\`\n` +
             `*Directo:* \`${cmd} <ID/nombre/celular>\``;
    }

    const resolved = await resolvePlayerTarget(msg, identifier);
    
    // Permitir expulsión de número o ID de 15 dígitos aunque no estén en la base
    const cleanId = normalizePhone(identifier) || identifier.replace(/\D/g, '');
    const isNumber = /^\d{10,20}$/.test(cleanId);
    
    let targetName = 'Desconocido';
    let targetPhones = [];
    let dbBanned = false;

    if (resolved.ok) {
      targetName = resolved.player.username;
      targetPhones = (resolved.player.phone || resolved.phone || '').split(',').map(p => normalizePhone(p.trim())).filter(Boolean);
      
      const { error } = await supabase
        .from('players')
        .update({ banned: true })
        .eq('id', resolved.player.id);
        
      dbBanned = !error;
    } else if (isNumber) {
      targetName = `Número ${cleanId}`;
      targetPhones = [cleanId];
      dbBanned = true; // Skip DB update since they don't exist
    } else {
      return describeResolutionError(identifier, resolved);
    }

    let kicked = false;
    try {
      const chat = await msg.getChat();
      if (chat.isGroup && targetPhones.length > 0) {
        const jidsToKick = targetPhones.map(p => `${p}@c.us`);
        await chat.removeParticipants(jidsToKick);
        kicked = true;
      }
    } catch (e) {
      console.error("Error al expulsar del grupo en !ban:", e);
    }

    if (dbBanned || kicked) {
      recordAdminAction({
        actorPhone,
        actorName,
        action: 'ban_player',
        target: `${targetName} (${targetPhones.join(', ')})`,
        detail: `Baneado en DB: ${resolved.ok}. Expulsado del grupo: ${kicked}.`,
        chatId: msg.from,
      });
      
      let msgText = `🔨 *${targetName}* ha sido desterrado del reino`;
      if (kicked) msgText += ` y expulsado del grupo.`;
      else msgText += `.`;
      return msgText;
    }

    return `❌ Error al banear o expulsar a *${targetName}*.`;
  }

  // 8. !censo o !fichas
  if (cmd === '!censo' || cmd === '!fichas') {
    try {
      const { players, sheets } = await getRealmCensus();
      
      let response = heraldCard('Censo general de aventureros', [
        heraldStat('Aventureros registrados', players.length),
      ], { icon: '📊' });
      
      const linkedPlayers = players.filter(p => p.phone);
      response += `\n${heraldStat('Vinculados a WhatsApp', `${linkedPlayers.length} (${Math.round((linkedPlayers.length / (players.length || 1)) * 100)}%)`)}`;
      response += `\n${heraldStat('PJs creados', `${sheets.length} en total`)}`;
      response += `\n\n${heraldSection('Registro de fichas y vinculaciones')}\n`;

      players.forEach((player, idx) => {
        // Encontrar fichas del jugador
        const playerSheets = sheets.filter(s => {
          const sheetPlayerId = String(s.playerId || s.player_id || '').trim();
          return sheetPlayerId === String(player.id).trim();
        });

        const numPjs = playerSheets.length;
        const linkedStatus = player.phone ? `✅ WhatsApp: +${player.phone}` : `❌ WhatsApp: No vinculado`;
        
        response += `${idx + 1}. *[${player.username}]*\n`;
        response += `   🔗 ${linkedStatus}\n`;
        
        if (numPjs > 0) {
          response += `   🎭 PJs (${numPjs}):\n`;
          playerSheets.forEach((s, sIdx) => {
            response += `   - ${s.name} (PJ ${sIdx + 1})\n`;
          });
        } else {
          // Calcular días transcurridos sin crear ficha
          const createdDate = new Date(player.created_at || Date.now());
          const diffTime = Math.abs(Date.now() - createdDate);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          
          response += `   ⏳ Sin Ficha (Pendiente) — Hace ${diffDays} día(s) ⚠️\n`;
        }
        response += `\n`;
      });

      return response.trim();
    } catch (err) {
      console.error(err);
      return `❌ Error al obtener el censo del reino.`;
    }
  }

  // 8.5 !actividad
  if (cmd === '!actividad' || cmd === '!inactivos') {
    try {
      const report = await getActivityReport();
      if (!report.length) return `✅ No hay registros de actividad.`;

      let response = heraldCard('Reporte de Actividad', [], { icon: '🕰️' });
      response += `\n\n\`\`\`\n`;
      response += `Aventurero      | Actividad\n`;
      response += `----------------|----------\n`;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      report.forEach(p => {
        let status = 'Desconocido';
        if (p.last_active_at) {
          const activeDateObj = new Date(p.last_active_at);
          const activeDate = new Date(activeDateObj);
          activeDate.setHours(0, 0, 0, 0);

          if (activeDate.getTime() === today.getTime()) {
            status = 'Hoy';
          } else if (activeDate.getTime() === yesterday.getTime()) {
            status = 'Ayer';
          } else {
            const diffDays = Math.floor((today.getTime() - activeDate.getTime()) / (1000 * 60 * 60 * 24));
            status = `Hace ${diffDays}d`;
          }
        }
        
        if (!p.phone) {
          status = 'Sin WA';
        }
        
        const uname = (p.username || 'SinNombre').slice(0, 15).padEnd(15, ' ');
        const statStr = status.padEnd(9, ' ');
        response += `${uname} | ${statStr}\n`;
      });
      response += `\`\`\``;

      return response;
    } catch (e) {
      return `❌ Hubo un error al obtener la actividad.`;
    }
  }

  // 9. !pendientes o !pendiente
  if (cmd === '!pendientes' || cmd === '!pendiente') {
    const chat = await msg.getChat();
    if (!chat.isGroup) {
      return `❌ Este comando solo se puede ejecutar dentro de un grupo de WhatsApp.`;
    }

    try {
      const {
        groupParticipants,
        unregisteredMembers,
        registeredWithoutPj,
        mentions,
        allPendingPhones,
      } = await getGroupPendingMembers(chat, client);

      let response = heraldCard('Reporte de pendientes del reino', [
        heraldStat('Miembros del grupo', groupParticipants.length),
        heraldStat('Sin registro', `${unregisteredMembers.length} personas`),
        heraldStat('Registrados sin ficha', `${registeredWithoutPj.length} personas`),
      ], { icon: '📋' });
      response += `\n\n`;

      if (unregisteredMembers.length > 0) {
        response += `${heraldSection('Sin registro / nuevos')}\n`;
        unregisteredMembers.forEach(member => {
          response += `- @${member.id.user}\n`;
        });
        response += `\n`;
      }

      if (registeredWithoutPj.length > 0) {
        response += `${heraldSection('Con cuenta pero sin ficha')}\n`;
        registeredWithoutPj.forEach(item => {
          response += `- @${item.participant.id.user} (User: *${item.player.username}*)\n`;
        });
        response += `\n`;
      }

      if (unregisteredMembers.length === 0 && registeredWithoutPj.length === 0) {
        // Limpiar tracker si todos están bien
        await trackUnregisteredUsers([]);
        response += `🎉 *¡Increíble! Todos los miembros del grupo están registrados y tienen sus fichas completadas.*`;
        await client.sendMessage(msg.from, response);
        return;
      }

      // Rastrear a todos los pendientes
      await trackUnregisteredUsers(allPendingPhones);

      response += `📢 Completen su ficha y vinculen su cuenta con \`!verificar\`.`;

      // Enviar el mensaje mencionando a los usuarios para que les llegue la notificación
      await client.sendMessage(msg.from, response, { mentions });
      return; 
    } catch (err) {
      console.error(err);
      return `❌ Error al procesar el reporte de pendientes.`;
    }
  }

  // 10. !purga
  if (cmd === '!purga') {
    const chat = await msg.getChat();
    if (!chat.isGroup) {
      return `❌ Este comando solo se puede ejecutar dentro de un grupo de WhatsApp.`;
    }

    try {
      // Usamos el tracker para ver quiénes llevan más de 3 días
      const {
        groupParticipants,
        unregisteredMembers,
        registeredWithoutPj,
        allPendingPhones,
      } = await getGroupPendingMembers(chat, client);
      const trackerData = await trackUnregisteredUsers(allPendingPhones);
      
      const now = Date.now();
      const PURGE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
      
      const toRemove = [];
      const toRemovePhones = [];
      const toWarn = [];
      const mentions = [];

      for (const participant of groupParticipants) {
        const phone = normalizePhone(participant.id.user);
        const jid = participant.id._serialized;
        
        if (jid === client.info.wid._serialized) continue;
        
        if (allPendingPhones.includes(phone) && trackerData[phone]) {
          const timeElapsed = now - trackerData[phone];
          if (timeElapsed >= PURGE_DAYS_MS) {
            toRemove.push(jid);
            toRemovePhones.push(phone);
          } else {
            const daysElapsed = Math.floor(timeElapsed / (24 * 60 * 60 * 1000));
            let daysLeft = 3 - daysElapsed;
            if (daysLeft < 1) daysLeft = 1;
            toWarn.push({ jid, user: participant.id.user, daysLeft });
            mentions.push(jid);
          }
        }
      }

      let response = '';

      if (toRemove.length > 0) {
        // Proceder a expulsarlos
        await chat.removeParticipants(toRemove);
        
        // Limpiar del tracker
        toRemovePhones.forEach(phone => delete trackerData[phone]);
        await saveTrackerData(trackerData);

        response = heraldCard('Purga completada', [
          `Se expulsaron ${toRemove.length} aventureros por inactividad de mas de 3 dias sin ficha:`,
        ], { icon: '☠️' });
        response += `\n`;
        toRemovePhones.forEach(phone => {
          response += `- +${phone}\n`;
        });

        recordAdminAction({
          actorPhone,
          actorName,
          action: 'purga',
          target: `${toRemove.length} expulsados`,
          detail: `Telefonos: ${toRemovePhones.join(', ')}`,
          chatId: msg.from,
        });
      }

      if (toWarn.length > 0) {
        if (response) response += `\n\n`;
        response += `${heraldSection('Aventureros en riesgo')}\n`;
        toWarn.forEach(warn => {
          const dayText = warn.daysLeft === 1 ? '1 dia' : `${warn.daysLeft} dias`;
          response += `- @${warn.user} ${dayText} para eliminacion\n`;
        });
      }

      if (toRemove.length === 0 && toWarn.length === 0) {
        return `✅ *No hay aventureros para purgar hoy.* Nadie está en la lista de pendientes.`;
      }

      if (mentions.length > 0) {
        await client.sendMessage(msg.from, response, { mentions });
        return;
      }
      
      return response;
    } catch (err) {
      console.error("Error en !purga:", err);
      return `❌ Hubo un error al ejecutar la purga. Verifica que el bot sea Administrador del grupo.`;
    }
  }

  // 11. !groupid
  if (cmd === '!groupid') {
    const isGroup = msg.from.endsWith('@g.us');
    if (!isGroup) {
      return `❌ Este comando solo puede ser usado dentro de un grupo de WhatsApp.`;
    }
    return heraldCard('ID del grupo', [msg.from], { icon: '📋' });
  }

  if (cmd === '!grupos') {
    if (!isSenderOwner) {
      return `❌ Solo el Soberano del Reino puede consultar la lista completa de grupos.`;
    }

    try {
      const chats = await client.getChats();
      const groups = chats
        .filter((chat) => chat?.isGroup)
        .map((chat) => ({
          name: chat.name || 'Grupo sin nombre',
          id: chat.id?._serialized || 'Sin ID',
        }));

      if (!groups.length) {
        return heraldCard('Grupos del Heraldo', [
          'El bot no se encuentra dentro de ningun grupo en este momento.',
        ], { icon: '👥' });
      }

      const lines = groups.map((group, index) =>
        `${index + 1}. *${group.name}*\n   ID: \`${group.id}\``
      );

      return heraldCard('Grupos del Heraldo', [
        heraldStat('Total', groups.length),
        '',
        lines.join('\n\n'),
      ], { icon: '👥' });
    } catch (error) {
      console.error('[admin grupos]', error);
      return `❌ No se pudo obtener la lista de grupos del Heraldo.`;
    }
  }

  if (cmd === '!grupoactual') {
    if (!isSenderOwner) {
      return `❌ Solo el Soberano del Reino puede inspeccionar la configuracion completa del grupo actual.`;
    }

    if (!msg.from.endsWith('@g.us')) {
      return `❌ Este comando solo puede usarse dentro de un grupo de WhatsApp.`;
    }

    try {
      const chat = await msg.getChat();
      const groupId = chat?.id?._serialized || msg.from;
      const groupName = chat?.name || 'Grupo sin nombre';
      const welcomeConfig = buildWelcomeConfig();
      const normalizedGroupName = String(groupName)
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      const welcomeEnabled = Boolean(
        welcomeConfig.enabled &&
        (
          (welcomeConfig.groupId && welcomeConfig.groupId === groupId) ||
          (welcomeConfig.groupName && welcomeConfig.groupName === normalizedGroupName)
        )
      );

      return heraldCard('Grupo actual', [
        heraldStat('Nombre', `*${groupName}*`),
        heraldStat('ID', `\`${groupId}\``),
        heraldStat('Bienvenida activa', welcomeEnabled ? 'Si' : 'No'),
      ], { icon: '📍' });
    } catch (error) {
      console.error('[admin grupoactual]', error);
      return `❌ No se pudo inspeccionar el grupo actual.`;
    }
  }

  if (cmd === '!bitacora') {
    const limit = parts[1] === 'full' ? 20 : 8;
    const entries = getRecentAdminActions(limit);
    if (!entries.length) {
      return `📚 La bitácora del reino aún no tiene acciones registradas.`;
    }

    const lines = entries.map((entry, index) => {
      const when = new Date(entry.at).toLocaleString('es-PY');
      return `${index + 1}. *${entry.action}*\n   ${entry.actorName || entry.actorPhone} → ${entry.target}\n   ${clipAudit(entry.detail)}\n   ${when}`;
    });

    return heraldCard('Bitacora del reino', [lines.join('\n\n')], { icon: '📚' });
  }

  // 12. !data (Knowledge upload)
  if (cmd === '!data') {
    if (!msg.hasMedia) {
      return `❌ Debes adjuntar un archivo .txt con el comando *!data [titulo]* para cargarlo a la base de conocimiento.`;
    }

    try {
      const media = await msg.downloadMedia();
      if (!media || !media.mimetype.includes('text/plain')) {
        return `❌ Solo se permiten archivos de texto plano (.txt).`;
      }

      const content = Buffer.from(media.data, 'base64').toString('utf-8');
      if (!content.trim()) {
        return `❌ El archivo está vacío.`;
      }

      const rawTitle = parts.slice(1).join(' ').trim();
      const title = rawTitle || media.filename || 'Documento sin titulo';

      // Dinamicamente importar upsertKnowledgeDocument
      const { upsertKnowledgeDocument } = await import('../supabase.js');

      const success = await upsertKnowledgeDocument({
        title,
        content,
        type: 'lore',
        category: 'bot-upload',
        source: 'whatsapp',
        summary: `Documento cargado vía WhatsApp por ${actorName}`,
        visible: true,
      });

      if (success) {
        recordAdminAction({
          actorPhone,
          actorName,
          action: 'upload_data',
          target: title,
          detail: `Cargó documento TXT de ${content.length} caracteres.`,
          chatId: msg.from,
        });
        return `✅ *Documento guardado:* "${title}" ha sido asimilado por el Archivista.`;
      } else {
        return `❌ Error al guardar el documento en la base de datos.`;
      }
    } catch (err) {
      console.error('[admin data upload]', err);
      return `❌ Hubo un error al procesar el archivo adjunto.`;
    }
  }

  return `❓ Comando admin no reconocido. Escribe *!admin* para ver la lista de comandos.`;
}

function clipAudit(value, max = 110) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Sin detalle.';
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
