import { supabase, updateGold, registerPlayer, getRealmCensus } from '../supabase.js';
import { isOwner, addAdmin, removeAdmin } from '../adminStore.js';

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

  // 0. Menu command !admin
  if (cmd === '!admin') {
    if (isSenderOwner) {
      return `👑 *MENÚ DEL SOBERANO (OWNER):*\n\n` +
             `👥 *!registrar <nombre> [oro]* (Respondiendo a un mensaje)\n` +
             `👥 *!registrar <celular> <nombre> [oro]* (Sin responder)\n` +
             `📊 *!censo* / *!fichas* (Censo general del reino)\n` +
             `📋 *!pendientes* (Reporte de no vinculados y sin ficha)\n` +
             `➕ *!add admin <numero>*\n` +
             `➖ *!remove admin <numero>*\n` +
             `📢 *!broadcast <mensaje>*\n` +
             `🪙 *!grant <celular> <monto>*\n` +
             `🔨 *!ban <celular>*\n` +
             `📊 *!stats*`;
    } else {
      return `🛡️ *MENÚ DE ADMINISTRADOR:*\n\n` +
             `👥 *!registrar <nombre> [oro]* (Respondiendo a un mensaje)\n` +
             `👥 *!registrar <celular> <nombre> [oro]* (Sin responder)\n` +
             `📊 *!censo* / *!fichas* (Censo general del reino)\n` +
             `📋 *!pendientes* (Reporte de no vinculados y sin ficha)\n` +
             `📢 *!broadcast <mensaje>*\n` +
             `🪙 *!grant <celular> <monto>*\n` +
             `🔨 *!ban <celular>*\n` +
             `📊 *!stats*`;
    }
  }

  // 1. !add admin <numero> (Owner only!)
  if (cmd === '!add' && parts[1]?.toLowerCase() === 'admin') {
    if (!isSenderOwner) {
      return `❌ Solo el Soberano del Reino puede otorgar funciones administrativas.`;
    }
    let target = '';
    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      target = extractPhone(quoted.author || quoted.from);
    } else {
      target = extractPhone(parts[2]);
    }

    if (!target) {
      return `❌ Uso correcto: *!add admin 595991234567* o responde a un mensaje con *!add admin*`;
    }
    const success = addAdmin(target);
    if (success) {
      await supabase.from('players').update({ is_admin: true }).eq('phone', target);
    }
    return success 
      ? `👑 *Soberanía concedida:* El número *${target}* ahora es Administrador del Reino.`
      : `❌ Error al guardar la lista de administradores.`;
  }

  // 2. !remove admin <numero> (Owner only!)
  if (cmd === '!remove' && parts[1]?.toLowerCase() === 'admin') {
    if (!isSenderOwner) {
      return `❌ Solo el Soberano del Reino puede revocar funciones administrativas.`;
    }
    let target = '';
    if (msg.hasQuotedMsg) {
      const quoted = await msg.getQuotedMessage();
      target = extractPhone(quoted.author || quoted.from);
    } else {
      target = extractPhone(parts[2]);
    }

    if (!target) {
      return `❌ Uso correcto: *!remove admin 595991234567* o responde a un mensaje con *!remove admin*`;
    }
    const success = removeAdmin(target);
    if (success) {
      await supabase.from('players').update({ is_admin: false }).eq('phone', target);
    }
    return success 
      ? `🛡️ *Soberanía revocada:* El número *${target}* ha dejado de ser Administrador.`
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

  // 4. !grant <numero> <monto>
  if (cmd === '!grant') {
    const phone = extractPhone(parts[1]);
    const amount = parseInt(parts[2]);

    if (!phone || isNaN(amount) || amount === 0) {
      return `❌ Uso correcto: *!grant 595991234567 500*`;
    }

    const { data: player, error } = await supabase
      .from('players')
      .select('id, username, gold')
      .eq('phone', phone)
      .maybeSingle();

    if (error || !player) return `❌ Jugador con número *${phone}* no encontrado.`;

    try {
      await updateGold(player.id, amount);
      const action = amount > 0 ? `+${amount.toLocaleString('es-PY')}` : `${amount.toLocaleString('es-PY')}`;
      return `✅ *${action} oro* aplicado a *${player.username}*\n🪙 Nuevo total: ${(player.gold + amount).toLocaleString('es-PY')}`;
    } catch {
      return `❌ Error al actualizar el oro.`;
    }
  }

  // 5. !broadcast <mensaje>
  if (cmd === '!broadcast') {
    const message = parts.slice(1).join(' ');
    if (!message.trim()) return `❌ Uso correcto: *!broadcast Tu mensaje aquí*`;

    const { data: players, error } = await supabase
      .from('players')
      .select('phone')
      .not('phone', 'is', null);

    if (error || !players?.length) return `❌ No hay jugadores registrados.`;

    let sent = 0;
    let failed = 0;
    for (const p of players) {
      try {
        await client.sendMessage(
          `${p.phone}@c.us`,
          `📢 *ANUNCIO DEL REINO*\n\n${message}`
        );
        sent++;
        await new Promise(r => setTimeout(r, 1000)); // anti-spam
      } catch {
        failed++;
      }
    }
    return `✅ Broadcast enviado: *${sent}* exitosos, *${failed}* fallidos.`;
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
    const phone = extractPhone(parts[1]);
    if (!phone) return `❌ Uso correcto: *!ban 595991234567*`;

    const { error } = await supabase
      .from('players')
      .update({ banned: true })
      .eq('phone', phone);

    return error ? `❌ Error al banear.` : `🔨 Jugador *${phone}* baneado del reino.`;
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

  // 9. !pendientes
  if (cmd === '!pendientes') {
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
        response += `🎉 *¡Increíble! Todos los miembros del grupo están registrados y tienen sus fichas completadas.*`;
        await client.sendMessage(msg.from, response);
        return;
      }

      response += `📢 *Por favor, completen su ficha web medieval y vinculen su cuenta usando !verificar.*`;

      // Enviar el mensaje mencionando a los usuarios para que les llegue la notificación
      await client.sendMessage(msg.from, response, { mentions });
      return; 
    } catch (err) {
      console.error(err);
      return `❌ Error al procesar el reporte de pendientes.`;
    }
  }

  return `❓ Comando admin no reconocido. Escribe *!admin* para ver la lista de comandos.`;
}
