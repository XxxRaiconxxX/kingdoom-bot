import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { normalizePhone } from './adminStore.js';

const DAILY_CLAIM_TYPE = 'heraldo_daily';

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

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function rankNameMatch(item, query) {
  const target = normalizeText(query);
  const name = normalizeText(item.name);
  const category = normalizeText(item.category);
  const description = normalizeText(item.description);

  if (name === target) return 4;
  if (name.startsWith(target)) return 3;
  if (name.includes(target)) return 2;
  if (category.includes(target) || description.includes(target)) return 1;
  return 0;
}

function formatAsuncionDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Asuncion',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const lookup = Object.fromEntries(parts.map((entry) => [entry.type, entry.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

export async function getPlayer(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  const { data, error } = await supabase.from('players').select('*').eq('phone', phone).single();

  if (error && error.code !== 'PGRST116') {
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

export async function getGoldLeaderboard(limit = 10) {
  const { data, error } = await supabase
    .from('players')
    .select('username, gold')
    .order('gold', { ascending: false })
    .limit(limit);

  if (error) console.error('[getGoldLeaderboard]', error.message);
  return data ?? [];
}

export async function getMarketItems() {
  const { data, error } = await supabase
    .from('market_items')
    .select('*')
    .eq('available', true)
    .order('price', { ascending: false });

  if (error) console.error('[getMarketItems]', error.message);
  return data ?? [];
}

export async function searchMarketItems(query, limit = 8) {
  const normalized = query?.trim();
  if (!normalized) return getMarketItems();

  const { data, error } = await supabase
    .from('market_items')
    .select('*')
    .eq('available', true)
    .or(`name.ilike.%${normalized}%,description.ilike.%${normalized}%,category.ilike.%${normalized}%`)
    .order('price', { ascending: false })
    .limit(limit);

  if (error) console.error('[searchMarketItems]', error.message);
  return data ?? [];
}

export async function getMarketItemDetails(query) {
  const items = await searchMarketItems(query, 12);
  if (!items.length) return null;

  return [...items].sort((left, right) => rankNameMatch(right, query) - rankNameMatch(left, query))[0] ?? null;
}

export async function getRealmSnapshot() {
  const [{ count: totalPlayers }, { count: availableItems }, { data: richest }, { data: weeklyChampion }] =
    await Promise.all([
      supabase.from('players').select('*', { count: 'exact', head: true }),
      supabase.from('market_items').select('*', { count: 'exact', head: true }).eq('available', true),
      supabase.from('players').select('username, gold').order('gold', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('players').select('username, weekly_gold').order('weekly_gold', { ascending: false }).limit(1).maybeSingle(),
    ]);

  return {
    totalPlayers: totalPlayers ?? 0,
    availableItems: availableItems ?? 0,
    richest: richest ?? null,
    weeklyChampion: weeklyChampion ?? null,
  };
}

export async function getActiveMissions(limit = 5) {
  const { data, error } = await supabase
    .from('realm_missions')
    .select('id, title, description, instructions, reward_gold, max_participants, difficulty, type, status, visible, created_at')
    .eq('visible', true)
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) console.error('[getActiveMissions]', error.message);
  return data ?? [];
}

export async function getMissionDetails(query) {
  const normalized = query?.trim();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('realm_missions')
    .select('id, title, description, instructions, reward_gold, max_participants, difficulty, type, status, visible, created_at')
    .eq('visible', true)
    .or(`title.ilike.%${normalized}%,description.ilike.%${normalized}%,instructions.ilike.%${normalized}%`)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) {
    console.error('[getMissionDetails]', error.message);
    return null;
  }

  if (!data?.length) return null;
  return [...data].sort((left, right) => rankNameMatch(right, normalized) - rankNameMatch(left, normalized))[0] ?? null;
}

export async function getActiveEvents(limit = 5) {
  const { data, error } = await supabase
    .from('realm_events')
    .select('id, title, description, long_description, start_date, end_date, status, rewards, requirements, participation_reward_gold, max_participants')
    .neq('status', 'finished')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) console.error('[getActiveEvents]', error.message);
  return data ?? [];
}

export async function getEventDetails(query) {
  const normalized = query?.trim();
  if (!normalized) return null;

  const { data, error } = await supabase
    .from('realm_events')
    .select('id, title, description, long_description, start_date, end_date, status, rewards, requirements, participation_reward_gold, max_participants')
    .or(`title.ilike.%${normalized}%,description.ilike.%${normalized}%,long_description.ilike.%${normalized}%`)
    .order('created_at', { ascending: false })
    .limit(8);

  if (error) {
    console.error('[getEventDetails]', error.message);
    return null;
  }

  if (!data?.length) return null;
  return [...data].sort((left, right) => rankNameMatch(right, normalized) - rankNameMatch(left, normalized))[0] ?? null;
}

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

export async function claimDailyReward(playerId, rewardGold) {
  const claimDate = formatAsuncionDateKey();
  const { data, error } = await supabase.rpc('claim_daily_reward', {
    p_player_id: playerId,
    p_claim_date: claimDate,
    p_reward_gold: rewardGold,
    p_claim_type: DAILY_CLAIM_TYPE,
  });

  if (error) {
    console.error('[claimDailyReward]', error.message);
    throw new Error('No se pudo registrar la recompensa diaria.');
  }

  return Boolean(data);
}

export async function hasClaimedDailyReward(playerId) {
  const claimDate = formatAsuncionDateKey();
  const { data, error } = await supabase
    .from('bot_daily_claims')
    .select('id, reward_gold, created_at')
    .eq('player_id', playerId)
    .eq('claim_type', DAILY_CLAIM_TYPE)
    .eq('claim_date', claimDate)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('[hasClaimedDailyReward]', error.message);
  }

  return data ?? null;
}

export async function registerPlayer(whatsappNumber, username, initialGold = 2500) {
  const phone = normalizePhone(whatsappNumber);

  if (!username || username.trim().length < 2) {
    return `❌ Indica un nombre valido.`;
  }

  const existing = await getPlayer(whatsappNumber);
  if (existing) {
    return `⚔️ Ya esta registrado en el reino como *${existing.username}* (Número: ${phone}).`;
  }

  const { error } = await supabase.from('players').insert([
    {
      phone,
      username: username.trim(),
      gold: initialGold,
      weekly_gold: 0,
    },
  ]);

  if (error) {
    console.error('[registerPlayer]', error.message);
    return `⚔️ Hubo un error al forjar su identidad en el reino. Intenta de nuevo.`;
  }

  return `✅ *BIENVENIDO A KINGDOOM*\n\n👤 Aventurero: *${username.trim()}*\n📞 Celular: *${phone}*\n🪙 Oro inicial: *${initialGold.toLocaleString('es-PY')}*\n\nEscribe *!ayuda* para comenzar tu viaje.`;
}
