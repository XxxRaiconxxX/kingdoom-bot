import {
  supabase,
  updateGold,
  registerPlayer,
  getRealmCensus,
  getStaffSnapshot,
  getActivityReport,
  awardManualMissionRankPoints,
  getPlayersByPhone,
  getRestrictedGroupCommandSummaryForDay,
  getRecycledCharacterSheets,
  findRecycledCharacterSheet,
  findPlayerByIdentifier,
  assignRecycledCharacterSheetToPlayer,
  getPlayerRoleplayAccess,
  manuallyLockRoleplayAccess,
  manuallyUnlockRoleplayAccess,
  extendRoleplayGraceForPlayer,
  forceRoleplayActivityForPlayer,
  getRoleplayLockWindowDays,
  upsertKnowledgeDocument,
} from '../supabase.js';
import { isOwner, isAdminUser, isStaffUser, addAdmin, removeAdmin, normalizePhone, formatJid } from '../adminStore.js';
import { trackUnregisteredUsers, saveTrackerData } from '../tracker.js';
import { recordAdminAction, getRecentAdminActions } from '../auditLog.js';
import { resolvePlayerTarget, safeGetQuotedDetails } from '../targetResolver.js';
import { decorateCommandReply, heraldCard, heraldCommand, heraldList, heraldSection, heraldStat } from '../formatting.js';
import { buildWelcomeConfig } from './welcome.js';
import { startMissionTracker, getActiveMissionsList, cancelActiveMission } from '../gmTracker.js';
import { resolveWhatsAppPhone, resolveWhatsAppPhones } from '../whatsappIdentity.js';
import { resolveAndDownloadMedia } from '../whatsappMedia.js';
import { canRunAdminCommand, isKnownAdminCommand } from '../adminCommands.js';
import { parseGoldAmount } from '../economy.js';

const DATA_MAX_FILE_BYTES = 1024 * 1024;
const DATA_MAX_CONTENT_CHARS = 500000;
const DATA_MAX_TITLE_CHARS = 160;

function normalizeKnowledgeTitle(value, fallback = 'Documento sin titulo') {
  const title = String(value || fallback)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (title || fallback).slice(0, DATA_MAX_TITLE_CHARS);
}

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
  const botId = client.info.wid._serialized;
  const candidateParticipants = groupParticipants.filter(
    (participant) => participant.id._serialized !== botId
  );
  const identityResolution = await resolveWhatsAppPhones(
    client,
    candidateParticipants.map((participant) => participant.id._serialized)
  );
  const participantPhones = new Map(
    identityResolution.resolved.map(({ id, phone }) => [id, phone])
  );

  for (const participant of candidateParticipants) {
    const jid = participant.id._serialized;
    const phone = participantPhones.get(jid);
    if (!phone) continue;

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
    participantPhones,
    allPendingPhones: [
      ...unregisteredMembers.map((member) => participantPhones.get(member.id._serialized)),
      ...registeredWithoutPj.map((member) => participantPhones.get(member.participant.id._serialized)),
    ].filter(Boolean),
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
const RESTRICTED_MINIGAME_GROUP_SCOPE_KEY = 'main';

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

function formatRecycledSheetLine(sheet, index) {
  const owner = sheet.originalPlayerUsername || sheet.originalPlayerId || 'origen desconocido';
  const race = sheet.race ? ` | ${sheet.race}` : '';
  const profession = sheet.profession ? ` | ${sheet.profession}` : '';
  const shortId = String(sheet.id ?? '').slice(0, 8);
  return `${index + 1}. *${sheet.name || 'Ficha sin nombre'}* (${shortId})${race}${profession}\n   Origen: ${owner}`;
}

async function resolvePlayerFromAssignmentInput(msg, rawText) {
  const mentions = Array.isArray(msg?.mentionedIds) ? msg.mentionedIds : [];
  if (mentions.length > 0) {
    const phone = await resolveWhatsAppPhone(msg?.client, mentions[0]);
    const players = await getPlayersByPhone(phone);
    const sheetQuery = rawText.replace(/@\S+/g, '').trim();

    if (players.length === 1) {
      return { ok: true, player: players[0], sheetQuery, targetLabel: players[0].username };
    }

    return {
      ok: false,
      reason: players.length > 1 ? 'ambiguous' : 'not_found',
      sheetQuery,
      targetLabel: phone ? `+${phone}` : 'mencion',
    };
  }

  const arrowParts = rawText.split(/\s+->\s+/);
  if (arrowParts.length === 2) {
    const sheetQuery = arrowParts[0].trim();
    const targetQuery = arrowParts[1].trim();
    const result = await findPlayerByIdentifier(targetQuery);
    return {
      ok: Boolean(result?.player),
      player: result?.player ?? null,
      sheetQuery,
      targetLabel: targetQuery,
      reason: result?.reason ?? 'not_found',
    };
  }

  const tokens = rawText.split(/\s+/).filter(Boolean);
  for (let index = tokens.length - 1; index > 0; index -= 1) {
    const targetQuery = tokens.slice(index).join(' ');
    const result = await findPlayerByIdentifier(targetQuery);
    if (result?.player) {
      return {
        ok: true,
        player: result.player,
        sheetQuery: tokens.slice(0, index).join(' ').trim(),
        targetLabel: targetQuery,
      };
    }
  }

  return { ok: false, reason: 'missing_target', sheetQuery: rawText, targetLabel: '' };
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
  const mentionResolution = await resolveWhatsAppPhones(msg?.client, msg?.mentionedIds ?? []);
  const uniquePhones = mentionResolution.phones;
  const resolvedTargets = [];
  const unresolved = [...mentionResolution.unresolved];
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
  const rawText = (typeof msg.caption === 'string' && msg.caption.trim().startsWith('!'))
    ? msg.caption.trim()
    : String(msg.body || '').trim();
  const text = rawText;
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

  if (
    isKnownAdminCommand(cmd)
    && !canRunAdminCommand(cmd, { isOwner: isSenderOwner, isAdmin, isStaff })
  ) {
    return 'Solo el rango autorizado puede ejecutar este comando administrativo.';
  }

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
          heraldCommand('!misionstart <ID> <@jugadores>', 'Inicia el GM para una mision con participantes.'),
          heraldCommand('!misioneson', 'Lista misiones activas y participantes.'),
          heraldCommand('!misionoff <ID> [@jugador]', 'Cierra una mision activa.'),
          heraldCommand('!faltasgrupo @jugador', 'Consulta faltas y multas de hoy en el grupo principal.'),
          heraldCommand('!fichasrecicladas', 'Lista fichas archivadas disponibles.'),
          heraldCommand('!asignarficha <ficha> @jugador', 'Entrega una ficha reciclada a un perfil.'),
          heraldCommand('!rolestado <jugador>', 'Consulta estado de roleo y bloqueo.'),
          heraldCommand('!rolbloquear <jugador>', 'Bloquea manualmente por roleo.'),
          heraldCommand('!roldesbloquear <jugador>', 'Desbloquea con gracia manual.'),
          heraldCommand('!rolgracia <jugador> <dias>', 'Extiende gracia de roleo.'),
          heraldCommand('!rolforzaractividad <jugador>', 'Marca roleo manual y desbloquea.'),
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
          heraldCommand('!misionstart <ID> <@jugadores>', 'Inicia el GM para una mision con participantes.'),
          heraldCommand('!misioneson', 'Lista misiones activas y participantes.'),
          heraldCommand('!misionoff <ID> [@jugador]', 'Cierra una mision activa.'),
          heraldCommand('!faltasgrupo @jugador', 'Consulta faltas y multas de hoy en el grupo principal.'),
          heraldCommand('!fichasrecicladas', 'Lista fichas archivadas disponibles.'),
          heraldCommand('!asignarficha <ficha> @jugador', 'Entrega una ficha reciclada a un perfil.'),
          heraldCommand('!rolestado <jugador>', 'Consulta estado de roleo y bloqueo.'),
          heraldCommand('!rolbloquear <jugador>', 'Bloquea manualmente por roleo.'),
          heraldCommand('!roldesbloquear <jugador>', 'Desbloquea con gracia manual.'),
          heraldCommand('!rolgracia <jugador> <dias>', 'Extiende gracia de roleo.'),
          heraldCommand('!rolforzaractividad <jugador>', 'Marca roleo manual y desbloquea.'),
        ]),
      ], { icon: '🛡️' });
    }
  }

  if (cmd === '!fichasrecicladas') {
    if (!isPrivileged) {
      return '❌ Solo el staff o los administradores pueden consultar fichas recicladas.';
    }

    const sheets = await getRecycledCharacterSheets(15);
    if (!sheets.length) {
      return heraldCard('Fichas recicladas', [
        heraldStat('Disponibles', '0'),
        'No hay fichas archivadas listas para reasignar.',
      ], { icon: '♻️' });
    }

    return heraldCard('Fichas recicladas', [
      heraldStat('Disponibles', sheets.length),
      '',
      sheets.map(formatRecycledSheetLine).join('\n\n'),
      '',
      'Asignacion: *!asignarficha <nombre o ID ficha> @jugador*',
      'Alternativa sin mencion: *!asignarficha <ficha> -> <perfil web>*',
    ], { icon: '♻️' });
  }

  if (cmd === '!asignarficha') {
    if (!isPrivileged) {
      return '❌ Solo el staff o los administradores pueden asignar fichas recicladas.';
    }

    const rawInput = parts.slice(1).join(' ').trim();
    if (!rawInput) {
      return '❌ Uso: *!asignarficha <nombre o ID ficha> @jugador*\nAlternativa: *!asignarficha <ficha> -> <perfil web>*';
    }

    const targetResult = await resolvePlayerFromAssignmentInput(msg, rawInput);
    if (!targetResult.ok || !targetResult.player) {
      if (targetResult.reason === 'ambiguous') {
        return `⚠️ El objetivo *${targetResult.targetLabel}* tiene multiples perfiles vinculados. Usa el nombre exacto del perfil web con *->*.`;
      }
      return `❌ No pude resolver el jugador destino. Usa *!asignarficha <ficha> @jugador* o *!asignarficha <ficha> -> <perfil web>*.`;
    }

    if (!targetResult.sheetQuery) {
      return '❌ Falta indicar que ficha reciclada asignar. Ejemplo: *!asignarficha Gwendolyn @jugador*';
    }

    const sheetResult = await findRecycledCharacterSheet(targetResult.sheetQuery);
    if (!sheetResult.sheet) {
      if (sheetResult.reason === 'empty') {
        return '❌ No hay fichas recicladas disponibles para asignar.';
      }
      if (sheetResult.reason === 'ambiguous') {
        const options = sheetResult.matches.slice(0, 5).map(formatRecycledSheetLine).join('\n\n');
        return `⚠️ Hay varias fichas que coinciden con *${targetResult.sheetQuery}*.\n\n${options}\n\nUsa mas letras del nombre o el ID corto.`;
      }
      return `❌ No encontre una ficha reciclada disponible para *${targetResult.sheetQuery}*.`;
    }

    try {
      const assignedSheet = await assignRecycledCharacterSheetToPlayer({
        sheetId: sheetResult.sheet.id,
        targetPlayerId: targetResult.player.id,
        actorName,
      });

      recordAdminAction({
        actorPhone,
        actorName,
        action: 'assign_recycled_sheet',
        target: targetResult.player.username,
        detail: `Ficha ${sheetResult.sheet.name} (${sheetResult.sheet.id}) asignada a ${targetResult.player.username}.`,
        chatId: msg.from,
      });

      return heraldCard('Ficha reciclada asignada', [
        heraldStat('Ficha', `*${assignedSheet?.name ?? sheetResult.sheet.name}*`),
        heraldStat('Nuevo portador', `*${targetResult.player.username}*`),
        heraldStat('Origen archivado', sheetResult.sheet.originalPlayerUsername || 'No registrado'),
        'La ficha ya debe aparecer en el apartado de fichas del jugador destino en la web.',
      ], { icon: '♻️' });
    } catch (error) {
      console.error('[admin asignarficha]', error);
      return `❌ No se pudo asignar la ficha reciclada. Motivo: ${error?.message ?? error}`;
    }
  }

  if (cmd === '!faltasgrupo') {
    if (!isPrivileged) {
      return '❌ Solo el staff o los administradores pueden consultar las faltas del grupo.';
    }

    if (!Array.isArray(msg.mentionedIds) || msg.mentionedIds.length !== 1) {
      return '❌ Uso: *!faltasgrupo @jugador*';
    }

    const { resolvedTargets, unresolved, ambiguous } = await resolveMissionCompletionTargets(msg);
    if (!resolvedTargets.length) {
      return unresolved.length
        ? `❌ La mención no corresponde a un jugador vinculado. Teléfono: +${unresolved.join(', +')}`
        : '❌ No pude resolver la mención hacia un perfil vinculado.';
    }

    if (ambiguous.length) {
      return `⚠️ La mención tiene múltiples perfiles vinculados: +${ambiguous.join(', +')}`;
    }

    const targetEntry = resolvedTargets[0];
    const summary = await getRestrictedGroupCommandSummaryForDay(
      targetEntry.player.id,
      RESTRICTED_MINIGAME_GROUP_SCOPE_KEY
    );

    if (!summary.count) {
      return heraldCard('Faltas del grupo principal', [
        heraldStat('Aventurero', `*${targetEntry.player.username}*`),
        heraldStat('Faltas hoy', '*0*'),
        heraldStat('Multas hoy', '*0 oro*'),
        'No hay advertencias ni sanciones registradas hoy para este aventurero.',
      ], { icon: '📘' });
    }

    const lines = summary.entries.map((entry) => {
      const when = entry.createdAt
        ? new Date(entry.createdAt).toLocaleTimeString('es-PY', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: 'America/Asuncion',
          })
        : '--:--';
      const amountText = entry.warningOnly
        ? 'advertencia'
        : `-${Number(entry.penaltyGold ?? 0).toLocaleString('es-PY')} oro`;
      return `${entry.strikeNumber}. !${entry.commandName} — ${amountText} — ${when}`;
    }).join('\n');

    return heraldCard('Faltas del grupo principal', [
      heraldStat('Aventurero', `*${targetEntry.player.username}*`),
      heraldStat('Faltas hoy', `*${summary.count}*`),
      heraldStat('Multas hoy', `*${Number(summary.totalPenaltyGold ?? 0).toLocaleString('es-PY')} oro*`),
      heraldSection('Detalle'),
      lines,
    ], { icon: '📘' });
  }

  if (cmd === '!rolestado' || cmd === '!rolbloquear' || cmd === '!roldesbloquear' || cmd === '!rolgracia' || cmd === '!rolforzaractividad') {
    if (!isPrivileged) {
      return '❌ Solo el staff o los administradores pueden operar el acceso por roleo.';
    }

    const identifier = parts
      .slice(1, cmd === '!rolgracia' ? -1 : undefined)
      .join(' ')
      .trim();

    if (!identifier) {
      return `❌ Uso: *${cmd} <jugador>*${cmd === '!rolgracia' ? ' <dias>' : ''}`;
    }

    const resolved = await resolvePlayerTarget(msg, identifier);
    if (!resolved.ok || !resolved.player) {
      return describeResolutionError(identifier, resolved);
    }

    if (cmd === '!rolestado') {
      const access = await getPlayerRoleplayAccess(resolved.player.id);
      const formatTimestamp = (value, fallback) =>
        value
          ? new Date(value).toLocaleString('es-PY', { timeZone: 'America/Asuncion' })
          : fallback;

      return heraldCard('Estado de roleo', [
        heraldStat('Aventurero', `*${resolved.player.username}*`),
        heraldStat('Ultimo roleo', formatTimestamp(access?.last_roleplay_at, 'Sin roleo registrado')),
        heraldStat('Bloqueado', access?.locked_at ? `Si (${formatTimestamp(access.locked_at, 'si')})` : 'No'),
        heraldStat('Motivo', access?.lock_reason || 'Ninguno'),
        heraldStat('Gracia', formatTimestamp(access?.grace_until, 'Sin gracia activa')),
        heraldStat('Exento', access?.is_exempt ? `Si (${access?.exempt_reason || 'manual'})` : 'No'),
        access?.last_roleplay_group_jid
          ? `Grupo de roleo mas reciente: *${access.last_roleplay_group_jid}*`
          : 'Sin grupo de roleo registrado aun.',
        `Bloqueo automatico vigente tras *${getRoleplayLockWindowDays()} dias* sin roleo.`,
      ], { icon: '🗣️' });
    }

    if (cmd === '!rolbloquear') {
      await manuallyLockRoleplayAccess(resolved.player.id, {
        actor: `${actorName}:${actorPhone}`,
        phone: resolved.player.phone || resolved.phone,
        reason: 'manual_roleplay_lock',
      });

      recordAdminAction({
        actorPhone,
        actorName,
        action: 'roleplay_lock',
        target: resolved.player.username,
        detail: 'Bloqueo manual de acceso por roleo.',
        chatId: msg.from,
      });

      return `⛔ *${resolved.player.username}* quedo bloqueado manualmente por roleo.`;
    }

    if (cmd === '!roldesbloquear') {
      await manuallyUnlockRoleplayAccess(resolved.player.id, {
        actor: `${actorName}:${actorPhone}`,
        phone: resolved.player.phone || resolved.phone,
        graceDays: getRoleplayLockWindowDays(),
      });

      recordAdminAction({
        actorPhone,
        actorName,
        action: 'roleplay_unlock',
        target: resolved.player.username,
        detail: `Desbloqueo manual con gracia de ${getRoleplayLockWindowDays()} dias.`,
        chatId: msg.from,
      });

      return `✅ *${resolved.player.username}* fue desbloqueado manualmente y recibio una gracia de *${getRoleplayLockWindowDays()} dias*.`;
    }

    if (cmd === '!rolgracia') {
      const requestedDays = Math.max(
        1,
        Number.parseInt(parts[parts.length - 1], 10) || getRoleplayLockWindowDays()
      );
      const graceUntil = await extendRoleplayGraceForPlayer(resolved.player.id, requestedDays, {
        actor: `${actorName}:${actorPhone}`,
        phone: resolved.player.phone || resolved.phone,
      });

      recordAdminAction({
        actorPhone,
        actorName,
        action: 'roleplay_grace',
        target: resolved.player.username,
        detail: `Gracia manual extendida por ${requestedDays} dias hasta ${graceUntil}.`,
        chatId: msg.from,
      });

      return `🕊️ *${resolved.player.username}* recibio una gracia manual de *${requestedDays} dias*.\nVence: *${new Date(graceUntil).toLocaleString('es-PY', { timeZone: 'America/Asuncion' })}*`;
    }

    await forceRoleplayActivityForPlayer(resolved.player.id, {
      actor: `${actorName}:${actorPhone}`,
      phone: resolved.player.phone || resolved.phone,
      groupJid: msg.from,
    });

    recordAdminAction({
      actorPhone,
      actorName,
      action: 'roleplay_force_activity',
      target: resolved.player.username,
      detail: 'Se marco actividad de roleo manual y se limpio el bloqueo.',
      chatId: msg.from,
    });

    return `✅ Se marco actividad de roleo manual para *${resolved.player.username}* y el acceso quedo restaurado.`;
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

    if (!shortId) {
      return '❌ Uso: *!misionstart <ID (6 caracteres)> <@jugadores>*';
    }

    const mentions = msg.mentionedIds || [];
    if (mentions.length === 0) {
      return '❌ Uso: *!misionstart <ID (6 caracteres)> <@jugadores>*. Debes mencionar al menos a un jugador.';
    }

    const mentionResolution = await resolveWhatsAppPhones(client, mentions);
    if (mentionResolution.unresolved.length > 0) {
      return '❌ WhatsApp no permitió resolver uno de los jugadores mencionados. Vuelve a mencionarlo y repite el comando.';
    }

    const result = await startMissionTracker(shortId, mentionResolution.phones);
    if (result.success && client) {
      await client.sendMessage(msg.from, decorateCommandReply(cmd, result.message), { mentions });
      return '';
    }
    return result.message;
  }

  if (cmd === '!misioneson') {
    if (!isPrivileged) {
      return '❌ Solo el staff o los administradores pueden ver las misiones activas.';
    }
    const list = getActiveMissionsList();
    if (list.length === 0) {
      return '📋 No hay misiones activas en este momento.';
    }

    const lines = [];
    const mentions = [];
    for (const state of list) {
      const roundText = `(Ronda ${state.gmRoundCount + 1})`;
      const playerMentions = state.participants
        .map(phone => {
          mentions.push(formatJid(phone));
          return `@${phone}`;
        })
        .join(', ');

      lines.push(`• *${state.shortId}* - ${state.title} ${roundText}\n  Participantes: ${playerMentions}`);
    }

    const text = heraldCard('Misiones Activas', [
      '📋 *Misiones activas en el Reino:*',
      ...lines
    ], { icon: '📋' });

    if (client && mentions.length > 0) {
      await client.sendMessage(msg.from, decorateCommandReply(cmd, text), { mentions });
      return '';
    }
    return text;
  }

  if (cmd === '!misionoff') {
    if (!isPrivileged) {
      return '❌ Solo el staff o los administradores pueden cerrar misiones.';
    }
    const shortId = parts[1];
    if (!shortId) {
      return '❌ Uso: *!misionoff <ID (6 caracteres)> [@jugador]*';
    }

    const targetShortId = shortId.toUpperCase();
    const mentionedJids = msg.mentionedIds || [];
    const list = getActiveMissionsList();
    
    // Find all active instances for this shortId
    const instances = list.filter(state => state.shortId === targetShortId);

    if (instances.length === 0) {
      return `❌ No se encontró ninguna misión activa con el ID *${targetShortId}*.`;
    }

    // Case 1: No player mentioned
    if (mentionedJids.length === 0) {
      if (instances.length === 1) {
        const state = instances[0];
        await cancelActiveMission(state.instanceId);
        return `✅ Misión *${state.title}* [${targetShortId}] de ${state.participants.map(phone => `@${phone}`).join(', ')} ha sido cerrada con éxito.`;
      } else {
        const lines = instances.map(state => {
          const playerMentions = state.participants.map(phone => `@${phone}`).join(', ');
          return `- Para cerrar la de ${playerMentions}: usa *!misionoff ${targetShortId} @${state.participants[0]}*`;
        });
        const allParticipantJids = instances.flatMap(state => state.participants.map(phone => formatJid(phone)));
        const text = `⚠️ Hay múltiples instancias activas para la misión *${targetShortId}*:\n\n${lines.join('\n')}`;
        
        if (client && allParticipantJids.length > 0) {
          await client.sendMessage(msg.from, decorateCommandReply(cmd, text), { mentions: allParticipantJids });
          return '';
        }
        return text;
      }
    }

    // Case 2: Player mentioned
    const targetJid = mentionedJids[0];
    const normalizedTargetPhone = await resolveWhatsAppPhone(client, targetJid);
    if (!normalizedTargetPhone) {
      return '❌ WhatsApp no permitió resolver al jugador mencionado. Vuelve a mencionarlo e intenta otra vez.';
    }
    const match = instances.find(state => state.participants.includes(normalizedTargetPhone));
    if (!match) {
      return `❌ No se encontró ninguna misión activa *${targetShortId}* para el jugador @${normalizedTargetPhone}.`;
    }

    await cancelActiveMission(match.instanceId);
    return `✅ Misión *${match.title}* [${targetShortId}] de @${normalizedTargetPhone} ha sido cerrada con éxito.`;
  }

  // 1. !add admin <nombre/celular> (Owner only!)
  if (cmd === '!add' && parts[1]?.toLowerCase() === 'admin') {
    if (!isSenderOwner) {
      return `❌ Solo el Soberano del Reino puede otorgar funciones administrativas.`;
    }
    let identifier = '';
    if (msg.hasQuotedMsg) {
      const quotedDetails = await safeGetQuotedDetails(msg);
      identifier = await resolveWhatsAppPhone(client, quotedDetails.author);
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
      const quotedDetails = await safeGetQuotedDetails(msg);
      identifier = await resolveWhatsAppPhone(client, quotedDetails.author);
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
      const quotedDetails = await safeGetQuotedDetails(msg);
      targetPhone = await resolveWhatsAppPhone(client, quotedDetails.author);
      
      username = parts[1];
      if (parts[2]) {
        const parsedGold = parseGoldAmount(parts[2], { allowZero: true });
        if (parsedGold === null) return 'El oro inicial debe ser un entero no negativo valido.';
        goldAmount = parsedGold;
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
        const parsedGold = parseGoldAmount(parts[3], { allowZero: true });
        if (parsedGold === null) return 'El oro inicial debe ser un entero no negativo valido.';
        goldAmount = parsedGold;
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
      const result = await registerPlayer(formatJid(cleanPhone), username.trim(), goldAmount);
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
      const quotedDetails = await safeGetQuotedDetails(msg);
      targetPhone = await resolveWhatsAppPhone(client, quotedDetails.author);
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
      const quotedDetails = await safeGetQuotedDetails(msg);
      identifier = await resolveWhatsAppPhone(client, quotedDetails.author);
      amount = parseGoldAmount(parts[1]);
    } else {
      amount = parseGoldAmount(parts[parts.length - 1]);
      identifier = parts.slice(1, -1).join(' ').trim();
    }

    if (!identifier || amount === null) {
      return `❌ *Uso correcto:*\n` +
             `*Respondiendo:* \`${cmd} <monto>\`\n` +
             `*Directo:* \`${cmd} <ID/nombre/celular> <monto>\``;
    }

    const finalAmount = cmd === '!quitar' ? -amount : amount;

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
      const quotedDetails = await safeGetQuotedDetails(msg);
      identifier = await resolveWhatsAppPhone(client, quotedDetails.author);
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
        const jidsToKick = targetPhones.map(p => formatJid(p));
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
        participantPhones,
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
          response += `- @${participantPhones.get(member.id._serialized)}\n`;
        });
        response += `\n`;
      }

      if (registeredWithoutPj.length > 0) {
        response += `${heraldSection('Con cuenta pero sin ficha')}\n`;
        registeredWithoutPj.forEach(item => {
          response += `- @${participantPhones.get(item.participant.id._serialized)} (User: *${item.player.username}*)\n`;
        });
        response += `\n`;
      }

      if (unregisteredMembers.length === 0 && registeredWithoutPj.length === 0) {
        // Limpiar tracker si todos están bien
        await trackUnregisteredUsers([]);
        response += `🎉 *¡Increíble! Todos los miembros del grupo están registrados y tienen sus fichas completadas.*`;
        await client.sendMessage(msg.from, decorateCommandReply(cmd, response));
        return;
      }

      // Rastrear a todos los pendientes
      await trackUnregisteredUsers(allPendingPhones);

      response += `📢 Completen su ficha y vinculen su cuenta con \`!verificar\`.`;

      // Enviar el mensaje mencionando a los usuarios para que les llegue la notificación
      await client.sendMessage(msg.from, decorateCommandReply(cmd, response), { mentions });
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
        participantPhones,
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
        const jid = participant.id._serialized;
        const phone = participantPhones.get(jid);
        
        if (jid === client.info.wid._serialized) continue;
        if (!phone) continue;
        
        if (allPendingPhones.includes(phone) && trackerData[phone]) {
          const timeElapsed = now - trackerData[phone];
          if (timeElapsed >= PURGE_DAYS_MS) {
            toRemove.push(jid);
            toRemovePhones.push(phone);
          } else {
            const daysElapsed = Math.floor(timeElapsed / (24 * 60 * 60 * 1000));
            let daysLeft = 3 - daysElapsed;
            if (daysLeft < 1) daysLeft = 1;
            toWarn.push({ jid, user: phone, daysLeft });
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
        await client.sendMessage(msg.from, decorateCommandReply(cmd, response), { mentions });
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
    let targetMsg;
    let media;
    try {
      ({ targetMsg, media } = await resolveAndDownloadMedia(msg, client));
    } catch (error) {
      console.error('[admin data resolve]', error?.message ?? error);
      return '❌ No se pudo leer el mensaje o archivo citado. Vuelve a adjuntarlo e intenta otra vez.';
    }

    const commandLine = rawText.split(/\r?\n/, 1)[0];
    const requestedTitle = commandLine.replace(/^!data\b/i, '').trim();
    let title = '';
    let content = '';

    if (targetMsg?.hasMedia) {
      if (!media?.data) {
        return '❌ WhatsApp no entregó el archivo. Vuelve a adjuntarlo directamente con *!data [titulo]*; los archivos antiguos o reenviados pueden haber caducado.';
      }

      const mime = String(media.mimetype || targetMsg.mimetype || '').toLowerCase();
      const filename = String(media.filename || targetMsg.filename || '').trim();
      const lowerFilename = filename.toLowerCase();
      const isTextMime = mime.startsWith('text/') || mime.includes('json');
      const isTextExtension = ['.txt', '.md', '.log', '.json']
        .some((extension) => lowerFilename.endsWith(extension));

      if (!isTextMime && !isTextExtension) {
        return '❌ Solo se permiten archivos de texto plano (.txt, .md, .log, .json).';
      }

      const approximateBytes = Math.floor(String(media.data).length * 3 / 4);
      if (Number(media.filesize) > DATA_MAX_FILE_BYTES || approximateBytes > DATA_MAX_FILE_BYTES) {
        return '❌ El archivo supera el límite de 1 MB permitido para *!data*.';
      }

      const fileBuffer = Buffer.from(media.data, 'base64');
      if (fileBuffer.length > DATA_MAX_FILE_BYTES) {
        return '❌ El archivo supera el límite de 1 MB permitido para *!data*.';
      }

      try {
        content = new TextDecoder('utf-8', { fatal: true }).decode(fileBuffer).replace(/\0/g, '');
      } catch {
        return '❌ El archivo no contiene texto UTF-8 válido. Guárdalo como UTF-8 y vuelve a intentarlo.';
      }
      title = normalizeKnowledgeTitle(requestedTitle, filename || 'Documento sin titulo');
    } else if (targetMsg?.body) {
      const quotedText = String(targetMsg.body).trim().replace(/\0/g, '');
      const isBotReply = /^(?:❌|🛡️|⚠️|✅|!data)/u.test(quotedText);
      if (isBotReply) {
        return '❌ El mensaje citado es una respuesta del bot. Cita el contenido original o adjunta el archivo directamente.';
      }
      content = quotedText;
      title = normalizeKnowledgeTitle(requestedTitle, 'Documento citado');
    } else {
      const lines = String(msg.body || rawText).trim().split(/\r?\n/);
      const inlineTitle = lines[0].replace(/^!data\b/i, '').trim();
      const bodyLines = lines.slice(1).join('\n').trim();

      if (inlineTitle && bodyLines) {
        title = normalizeKnowledgeTitle(inlineTitle);
        content = bodyLines.replace(/\0/g, '');
      }
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      return [
        '❌ No se encontró contenido de texto para guardar.',
        '- Adjunta un archivo con *!data [titulo]*.',
        '- Responde a un archivo o mensaje con *!data [titulo]*.',
        '- O escribe *!data Titulo* y el contenido en las líneas siguientes.',
      ].join('\n');
    }

    if (trimmedContent.length > DATA_MAX_CONTENT_CHARS) {
      return `❌ El documento tiene ${trimmedContent.length.toLocaleString('es-PY')} caracteres; el límite es 500.000.`;
    }

    try {
      const success = await upsertKnowledgeDocument({
        title,
        content: trimmedContent,
        type: 'lore',
        category: 'bot-upload',
        source: 'whatsapp',
        summary: `Documento cargado vía WhatsApp por ${actorName}`,
        visible: true,
      });

      if (!success) {
        return '❌ La base de datos no confirmó el guardado del documento.';
      }

      recordAdminAction({
        actorPhone,
        actorName,
        action: 'upload_data',
        target: title,
        detail: `Cargó documento de ${trimmedContent.length} caracteres.`,
        chatId: msg.from,
      });
      return `✅ *Documento guardado:* "${title}" (${trimmedContent.length} caracteres) fue asimilado por el Archivista.`;
    } catch (error) {
      console.error('[admin data upload]', error);
      return '❌ Hubo un error al guardar el documento. No se registró como completado.';
    }
  }

  return `❓ Comando admin no reconocido. Escribe *!admin* para ver la lista de comandos.`;
}

function clipAudit(value, max = 110) {
  const clean = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Sin detalle.';
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}
