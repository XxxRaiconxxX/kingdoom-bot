import { supabase, updateGold, registerPlayer, getRealmCensus } from '../supabase.js';
import { isOwner, addAdmin, removeAdmin } from '../adminStore.js';
import { trackUnregisteredUsers, getTrackerData, saveTrackerData } from '../tracker.js';

export async function handleAdminCommand(msg, client) {
  const text = msg.body.trim();
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const sender = msg.author || msg.from;

  const isSenderOwner = isOwner(sender);

  // Helper function to extract number from input (remove @c.us if present, only digits)
  const extractPhone = (input) => {
    if (!input) return '';
    return input.replace('@c.us', '').replace(/\D/g, '').trim();
  };

  // Helper to find a player by phone, exact username, or UUID prefix (ID)
  const findAdminTarget = async (identifier) => {
    const isPhone = /^[\d\+\s]+$/.test(identifier);
    if (isPhone) {
      const phone = extractPhone(identifier);
      const { data } = await supabase.from('players').select('*').eq('phone', phone).maybeSingle();
      return { player: data, isPhone: true, phone };
    }

    // 1. Username exact match (case-insensitive)
    let { data: player } = await supabase
      .from('players')
      .select('*')
      .ilike('username', identifier)
      .maybeSingle();

    // 2. UUID prefix match
    if (!player && identifier.length >= 4) {
      const { data: allPlayers } = await supabase.from('players').select('*');
      if (allPlayers) {
        const matches = allPlayers.filter(p => p.id.toLowerCase().startsWith(identifier.toLowerCase()));
        if (matches.length === 1) player = matches[0];
      }
    }

    return { player, isPhone: false };
  };

  // 0. Menu command !admin
  if (cmd === '!admin') {
    if (isSenderOwner) {
      return `👑 *MENÚ DEL SOBERANO (OWNER):*\n\n` +
             `👥 *!registrar <nombre> [oro]* (Respondiendo a un mensaje)\n` +
             `👥 *!registrar <celular> <nombre> [oro]* (Sin responder)\n` +
             `📊 *!censo* / *!fichas* (Censo general del reino)\n` +
             `📋 *!pendientes* (Reporte de no vinculados y sin ficha)\n` +
             `☠️ *!purga* (Expulsar a los que llevan >5 días en pendientes)\n` +
             `➕ *!add admin <ID/nombre/celular>*\n` +
             `➖ *!remove admin <ID/nombre/celular>*\n` +
             `🪙 *!grant <ID/nombre/celular> <monto>*\n` +
             `💸 *!quitar <ID/nombre/celular> <monto>*\n` +
             `🔨 *!ban <ID/nombre/celular>*\n` +
             `📋 *!groupid* (Obtener ID del grupo actual)\n` +
             `📊 *!stats*`;
    } else {
      return `🛡️ *MENÚ DE ADMINISTRADOR:*\n\n` +
             `👥 *!registrar <nombre> [oro]* (Respondiendo a un mensaje)\n` +
             `👥 *!registrar <celular> <nombre> [oro]* (Sin responder)\n` +
             `📊 *!censo* / *!fichas* (Censo general del reino)\n` +
             `📋 *!pendientes* (Reporte de no vinculados y sin ficha)\n` +
             `☠️ *!purga* (Expulsar a los que llevan >5 días en pendientes)\n` +
             `🪙 *!grant <ID/nombre/celular> <monto>*\n` +
             `💸 *!quitar <ID/nombre/celular> <monto>*\n` +
             `🔨 *!ban <ID/nombre/celular>*\n` +
             `📋 *!groupid* (Obtener ID del grupo actual)\n` +
             `📊 *!stats*`;
    }
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

    const { player, isPhone, phone } = await findAdminTarget(identifier);

    let targetPhone = player ? player.phone : (isPhone ? phone : null);
    let targetName = player ? player.username : identifier;

    if (!targetPhone) return `❌ No se pudo determinar el celular de *${identifier}*.`;

    const success = addAdmin(targetPhone);
    if (success && player) {
      await supabase.from('players').update({ is_admin: true }).eq('phone', targetPhone);
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

    const { player, isPhone, phone } = await findAdminTarget(identifier);

    let targetPhone = player ? player.phone : (isPhone ? phone : null);
    let targetName = player ? player.username : identifier;

    if (!targetPhone) return `❌ No se pudo determinar el celular de *${identifier}*.`;

    const success = removeAdmin(targetPhone);
    if (success && player) {
      await supabase.from('players').update({ is_admin: false }).eq('phone', targetPhone);
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
        return `❌ *Error de registro:*\n` +
               `*Opción A (Copiado/Respondiendo):* Cita el mensaje del jugador con: \`!registrar <nombre> [oro]\`\n` +
               `*Opción B (Directo/Manual):* Escribe de forma directa: \`!registrar <celular> <nombre> [oro]\``;
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
    if (!cleanPhone || isNaN(Number(cleanPhone))) {
      return `❌ Número de celular no válido.`;
    }

    if (!username || username.trim().length < 2) {
      return `❌ Especifica un nombre de usuario válido de al menos 2 caracteres.`;
    }

    // Ejecutar registro
    try {
      const result = await registerPlayer(`${cleanPhone}@c.us`, username.trim(), goldAmount);
      return result;
    } catch (err) {
      console.error('[admin registrar]', err);
      return `❌ Error al registrar en Supabase: ${err.message}`;
    }
  }

  // 4. !grant y !quitar
  if (cmd === '!grant' || cmd === '!quitar') {
    let identifier = '';
    let amount = 0;

    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      identifier = extractPhone(quoted.author || quoted.from);
      amount = parseInt(parts[1]);
    } else {
      amount = parseInt(parts[parts.length - 1]);
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

    const { player } = await findAdminTarget(identifier);

    if (!player) return `❌ Jugador *${identifier}* no encontrado en el reino.`;

    try {
      await updateGold(player.id, finalAmount);
      // Re-fetch para tener el saldo real
      const { data: updated } = await supabase.from('players').select('gold').eq('id', player.id).maybeSingle();
      const newTotal = updated?.gold ?? (player.gold + finalAmount);
      const action = finalAmount > 0 ? `+${finalAmount.toLocaleString('es-PY')}` : `${finalAmount.toLocaleString('es-PY')}`;
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

    return `📊 *Stats del Reino:*\n\n👥 Jugadores: ${totalPlayers}\n💰 Más rico: ${richest?.username ?? '—'} (${(richest?.gold ?? 0).toLocaleString('es-PY')} oro)`;
  }

  // 7. !ban
  if (cmd === '!ban') {
    let identifier = '';
    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      identifier = extractPhone(quoted.author || quoted.from);
    } else {
      identifier = parts.slice(1).join(' ').trim();
    }

    if (!identifier) {
      return `❌ *Uso correcto de !ban:*\n` +
             `*Respondiendo:* \`!ban\`\n` +
             `*Directo:* \`!ban <ID/nombre/celular>\``;
    }

    const { player: target } = await findAdminTarget(identifier);

    if (!target) return `❌ No existe ningún jugador con el ID/nombre/número *${identifier}* en el reino.`;

    const { error } = await supabase
      .from('players')
      .update({ banned: true })
      .eq('id', target.id);

    return error ? `❌ Error al banear a *${target.username}*.` : `🔨 *${target.username}* (${target.phone}) ha sido desterrado del reino.`;
  }

  // 8. !censo o !fichas
  if (cmd === '!censo' || cmd === '!fichas') {
    try {
      const { players, sheets } = await getRealmCensus();
      
      let response = `📊 *CENSO GENERAL DE AVENTUREROS* 🏰\n\n`;
      response += `👥 *Aventureros Registrados:* ${players.length}\n`;
      
      const linkedPlayers = players.filter(p => p.phone);
      response += `🔗 *Vinculados a WhatsApp:* ${linkedPlayers.length} (${Math.round((linkedPlayers.length / (players.length || 1)) * 100)}%)\n`;
      response += `🎭 *PJs Creados:* ${sheets.length} en total\n\n`;
      response += `⚔️ *REGISTRO DE FICHAS Y VINCULACIONES:*\n\n`;

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

  // 9. !pendientes o !pendiente
  if (cmd === '!pendientes' || cmd === '!pendiente') {
    const chat = await msg.getChat();
    if (!chat.isGroup) {
      return `❌ Este comando solo se puede ejecutar dentro de un grupo de WhatsApp.`;
    }

    try {
      const { players, sheets } = await getRealmCensus();
      
      const groupParticipants = chat.participants; 
      const registeredPhones = new Set(
        players.map(p => String(p.phone || '').trim().replace(/\D/g, ''))
      );

      const unregisteredMembers = [];
      const registeredWithoutPj = [];
      const mentions = [];

      for (const participant of groupParticipants) {
        const phone = participant.id.user;
        const jid = participant.id._serialized;
        
        // Excluir al propio bot del listado
        if (jid === client.info.wid._serialized) continue;

        if (!registeredPhones.has(phone)) {
          unregisteredMembers.push(participant);
          mentions.push(jid);
        } else {
          // Si está registrado, verificar si tiene ficha
          const playerObj = players.find(p => String(p.phone || '').trim().replace(/\D/g, '') === phone);
          if (playerObj) {
            const hasSheets = sheets.some(s => {
              const sheetPlayerId = String(s.playerId || s.player_id || '').trim();
              return sheetPlayerId === String(playerObj.id).trim();
            });
            if (!hasSheets) {
              registeredWithoutPj.push({ player: playerObj, participant });
              mentions.push(jid);
            }
          }
        }
      }

      let response = `📋 *REPORTE DE PENDIENTES DEL REINO* 🏰\n\n`;
      response += `👥 *Miembros del Grupo:* ${groupParticipants.length}\n`;
      response += `🔴 *Sin Registro:* ${unregisteredMembers.length} personas\n`;
      response += `🟡 *Registrados sin Ficha:* ${registeredWithoutPj.length} personas\n\n`;

      if (unregisteredMembers.length > 0) {
        response += `🔴 *SIN REGISTRO / NUEVOS (No vinculados):*\n`;
        unregisteredMembers.forEach(member => {
          response += `- @${member.id.user}\n`;
        });
        response += `\n`;
      }

      if (registeredWithoutPj.length > 0) {
        response += `🟡 *CON CUENTA PERO SIN FICHA (Pendientes):*\n`;
        registeredWithoutPj.forEach(item => {
          response += `- @${item.participant.id.user} (User: *${item.player.username}*)\n`;
        });
        response += `\n`;
      }

      if (unregisteredMembers.length === 0 && registeredWithoutPj.length === 0) {
        // Limpiar tracker si todos están bien
        trackUnregisteredUsers([]);
        response += `🎉 *¡Increíble! Todos los miembros del grupo están registrados y tienen sus fichas completadas.*`;
        await client.sendMessage(msg.from, response);
        return;
      }

      // Rastrear a todos los pendientes
      const allPendingPhones = [
        ...unregisteredMembers.map(m => m.id.user),
        ...registeredWithoutPj.map(m => m.participant.id.user)
      ];
      trackUnregisteredUsers(allPendingPhones);

      response += `📢 *Por favor, completen su ficha web medieval y vinculen su cuenta usando !verificar.*`;

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
      // Usamos el tracker para ver quiénes llevan más de 5 días
      const trackerData = getTrackerData();
      const groupParticipants = chat.participants;
      
      const now = Date.now();
      const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
      
      const toRemove = [];
      const toRemovePhones = [];

      for (const participant of groupParticipants) {
        const phone = participant.id.user;
        const jid = participant.id._serialized;
        
        if (trackerData[phone]) {
          const timeElapsed = now - trackerData[phone];
          if (timeElapsed >= FIVE_DAYS_MS) {
            toRemove.push(jid);
            toRemovePhones.push(phone);
          }
        }
      }

      if (toRemove.length === 0) {
        return `✅ *No hay aventureros para purgar hoy.* Nadie ha superado el límite de 5 días sin ficha.`;
      }

      // Proceder a expulsarlos
      await chat.removeParticipants(toRemove);
      
      // Limpiar del tracker
      toRemovePhones.forEach(phone => delete trackerData[phone]);
      saveTrackerData(trackerData);

      let response = `☠️ *PURGA COMPLETADA* ☠️\n\nSe han expulsado ${toRemove.length} aventureros por inactividad (más de 5 días sin ficha):\n`;
      toRemovePhones.forEach(phone => {
        response += `- +${phone}\n`;
      });
      
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
    return `📋 *ID del Grupo:* ${msg.from}`;
  }

  return `❓ Comando admin no reconocido. Escribe *!admin* para ver la lista de comandos.`;
}
