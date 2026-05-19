import { supabase, updateGold } from '../supabase.js';

export async function handleAdminCommand(msg, client) {
  const text = msg.body.trim();
  const parts = text.split(' ');
  const cmd = parts[0].toLowerCase();

  if (cmd === '!grant') {
    // ✅ Validación de inputs
    const phone = parts[1];
    const amount = parseInt(parts[2]);

    if (!phone || isNaN(amount) || amount === 0) {
      return `❌ Uso correcto: *!grant 595991234567 500*`;
    }

    const { data: player, error } = await supabase
      .from('players')
      .select('id, username, gold')
      .eq('phone', phone)
      .single();

    if (error || !player) return `❌ Jugador con número *${phone}* no encontrado.`;

    try {
      await updateGold(player.id, amount);
      const accion = amount > 0 ? `+${amount}` : `${amount}`;
      return `✅ *${accion} oro* aplicado a *${player.username}*\n🪙 Nuevo total: ${player.gold + amount}`;
    } catch {
      return `❌ Error al actualizar el oro.`;
    }
  }

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

  if (cmd === '!stats') {
    const { count: totalPlayers } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true });

    const { data: richest } = await supabase
      .from('players')
      .select('username, gold')
      .order('gold', { ascending: false })
      .limit(1)
      .single();

    return `📊 *Stats del Reino:*\n\n👥 Jugadores: ${totalPlayers}\n💰 Más rico: ${richest?.username ?? '—'} (${richest?.gold ?? 0} oro)`;
  }

  if (cmd === '!ban') {
    const phone = parts[1];
    if (!phone) return `❌ Uso correcto: *!ban 595991234567*`;

    const { error } = await supabase
      .from('players')
      .update({ banned: true })
      .eq('phone', phone);

    return error ? `❌ Error al banear.` : `🔨 Jugador *${phone}* baneado del reino.`;
  }

  return `❓ Comando admin no reconocido. Comandos: !grant, !broadcast, !stats, !ban`;
}
