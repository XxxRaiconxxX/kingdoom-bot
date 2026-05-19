import { createClient } from '@supabase/supabase-js';

import ws from 'ws';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: {
      persistSession: false,
    },
    realtime: {
      transport: ws,
    },
  }
);

export async function getPlayer(whatsappNumber) {
  const phone = whatsappNumber.replace('@c.us', '');
  const { data, error } = await supabase
    .from('players')
    .select('*')
    .eq('phone', phone)
    .single();
  if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found (esperado)
    console.error('[getPlayer]', error.message);
  }
  return data ?? null;
}

export async function getLeaderboard() {
  const { data, error } = await supabase
    .from('players')
    .select('username, gold, weekly_gold')
    .order('weekly_gold', { ascending: false })
    .limit(10);
  if (error) console.error('[getLeaderboard]', error.message);
  return data ?? [];
}

export async function getMarketItems() {
  const { data, error } = await supabase
    .from('market_items')
    .select('*')
    .eq('available', true);
  if (error) console.error('[getMarketItems]', error.message);
  return data ?? [];
}

// ✅ Atómico — evita race condition con dos operaciones separadas
export async function updateGold(playerId, amount) {
  const { error } = await supabase.rpc('increment_gold', {
    player_id: playerId,
    amount,
  });
  if (error) {
    console.error('[updateGold]', error.message);
    throw new Error('No se pudo actualizar el oro.');
  }
}

export async function registerPlayer(whatsappNumber, username) {
  const phone = whatsappNumber.replace('@c.us', '');

  if (!username || username.trim().length < 2) {
    return `❌ Indicá un nombre válido. Ejemplo: *!registrar Aragorn*`;
  }

  const existing = await getPlayer(whatsappNumber);
  if (existing) {
    return `⚔️ Ya estás registrado en el reino como *${existing.username}*.`;
  }

  const { error } = await supabase
    .from('players')
    .insert([{
      phone,
      username: username.trim(),
      gold: 100,
      weekly_gold: 0, // ✅ corregido: arranca en 0, no en 100
    }]);

  if (error) {
    console.error('[registerPlayer]', error.message);
    return `⚔️ Hubo un error al forjar tu identidad en el reino. Intentá de nuevo.`;
  }

  return `✅ *¡Bienvenido a Kingdoom, ${username.trim()}!*\n\nSe te han otorgado 🪙 *100 de oro* para comenzar tu viaje.\n\nEscribí *!ayuda* para ver qué podés hacer.`;
}
