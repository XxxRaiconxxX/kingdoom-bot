import { supabase, updateGold, registerPlayer } from '../supabase.js';
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
    const target = extractPhone(parts[2]);
    if (!target) {
      return `❌ Uso correcto: *!add admin 595991234567*`;
    }
    const success = addAdmin(target);
    return success 
      ? `👑 *Soberanía concedida:* El número *${target}* ahora es Administrador del Reino.`
      : `❌ Error al guardar la lista de administradores.`;
  }

  // 2. !remove admin <numero> (Owner only!)
  if (cmd === '!remove' && parts[1]?.toLowerCase() === 'admin') {
    if (!isSenderOwner) {
      return `❌ Solo el Soberano del Reino puede revocar funciones administrativas.`;
    }
    const target = extractPhone(parts[2]);
    if (!target) {
      return `❌ Uso correcto: *!remove admin 595991234567*`;
    }
    const success = removeAdmin(target);
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
      targetPhone = quoted.from;
      
      username = parts[1];
      if (parts[2]) {
        const parsedGold = parseInt(parts[2].replace(/\./g, ''));
        if (!isNaN(parsedGold)) goldAmount = parsedGold;
      }
    } else {
      // Caso 2: Sin responder -> !registrar <celular> <nombre> [oro]
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

  return `❓ Comando admin no reconocido. Escribe *!admin* para ver la lista de comandos.`;
}
