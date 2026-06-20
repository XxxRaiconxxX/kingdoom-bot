import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { normalizePhone } from './adminStore.js';
import { getActiveProfile } from './activeProfileStore.js';

const DAILY_CLAIM_TYPE = 'heraldo_daily';
const SUPABASE_REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.SUPABASE_REQUEST_TIMEOUT_MS ?? '10000', 10) || 10000
);
const PHONE_LOOKUP_TTL_MS = Math.max(
  10000,
  Number.parseInt(process.env.PHONE_LOOKUP_TTL_MS ?? '45000', 10) || 45000
);
const PHONE_LOOKUP_CACHE_LIMIT = Math.max(
  50,
  Number.parseInt(process.env.PHONE_LOOKUP_CACHE_LIMIT ?? '500', 10) || 500
);
const PLAYER_SELECT_COLUMNS = 'id, username, gold, weekly_gold, phone, is_admin, banned, created_at, last_active_at';
const PLAYER_IDENTITY_COLUMNS = 'id, username, gold, weekly_gold, phone, is_admin, banned';
const phoneLookupCache = new Map();
const BOT_STATE_SELECT_COLUMNS = 'id, claim_type, claim_date, reward_gold, created_at';

async function supabaseTimedFetch(resource, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SUPABASE_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(resource, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function prunePhoneLookupCache() {
  if (phoneLookupCache.size < PHONE_LOOKUP_CACHE_LIMIT) {
    return;
  }

  const oldestKey = phoneLookupCache.keys().next().value;
  if (oldestKey) {
    phoneLookupCache.delete(oldestKey);
  }
}

function readPhoneLookupCache(phone) {
  const cached = phoneLookupCache.get(phone);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    phoneLookupCache.delete(phone);
    return null;
  }

  return cached.players;
}

function writePhoneLookupCache(phone, players) {
  prunePhoneLookupCache();
  phoneLookupCache.set(phone, {
    players,
    expiresAt: Date.now() + PHONE_LOOKUP_TTL_MS,
  });
}

function createServiceClient(url, serviceKey) {
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
    },
    realtime: {
      transport: ws,
    },
    global: {
      fetch: supabaseTimedFetch,
    },
  });
}

export const supabase = createServiceClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const botStateSupabaseUrl = process.env.BOT_SUPABASE_URL || process.env.SUPABASE_URL;
const botStateSupabaseServiceKey =
  process.env.BOT_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_KEY;

export const botStateSupabase = createServiceClient(
  botStateSupabaseUrl,
  botStateSupabaseServiceKey
);

export const usingDedicatedBotStateSupabase = Boolean(
  process.env.BOT_SUPABASE_URL && process.env.BOT_SUPABASE_SERVICE_KEY
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

export async function getPlayersByPhone(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  if (!phone) return [];

  const cachedPlayers = readPhoneLookupCache(phone);
  if (cachedPlayers) {
    return cachedPlayers;
  }

  const { data, error } = await supabase
    .from('players')
    .select(PLAYER_SELECT_COLUMNS)
    .ilike('phone', `%${phone}%`)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getPlayersByPhone]', error.message);
    return [];
  }

  if (!data) return [];

  // Exact match filtering to avoid substring issues (e.g., 59598112345 matching 595981123456)
  const matchedPlayers = data.filter(player => {
    if (!player.phone) return false;
    const phones = player.phone.split(',').map(p => p.trim());
    return phones.includes(phone);
  });

  writePhoneLookupCache(phone, matchedPlayers);
  return matchedPlayers;
}

export async function getPlayer(whatsappNumber) {
  const players = await getPlayersByPhone(whatsappNumber);
  if (!players.length) return null;
  
  const activeId = getActiveProfile(whatsappNumber);
  if (activeId) {
    const activePlayer = players.find(p => p.id === activeId);
    if (activePlayer) return activePlayer;
  }
  return players[0];
}

export async function findPlayerByIdentifier(identifier) {
  const rawIdentifier = String(identifier ?? '').trim();
  if (!rawIdentifier) {
    return { player: null, matchType: 'none', reason: 'missing', phone: '' };
  }

  const normalizedIdentifier = normalizeText(rawIdentifier);
  const normalizedPhone = normalizePhone(rawIdentifier);
  const allPlayersQuery = async () => {
    const { data, error } = await supabase.from('players').select(PLAYER_IDENTITY_COLUMNS);
    if (error) {
      console.error('[findPlayerByIdentifier]', error.message);
      return [];
    }
    return data ?? [];
  };

  if (/^\d+$/.test(normalizedPhone)) {
    const phoneMatches = await getPlayersByPhone(normalizedPhone);
    if (phoneMatches.length === 1) {
      return { player: phoneMatches[0], matchType: 'phone', reason: 'ok', phone: normalizedPhone };
    }
    if (phoneMatches.length > 1) {
      return { player: null, matchType: 'phone', reason: 'ambiguous', phone: normalizedPhone };
    }
  }

  const { data: exactPlayer, error: exactError } = await supabase
    .from('players')
    .select(PLAYER_IDENTITY_COLUMNS)
    .ilike('username', rawIdentifier)
    .maybeSingle();

  if (exactError && exactError.code !== 'PGRST116') {
    console.error('[findPlayerByIdentifier.username]', exactError.message);
  }

  if (exactPlayer) {
    return { player: exactPlayer, matchType: 'username-exact', reason: 'ok', phone: exactPlayer.phone ?? '' };
  }

  const allPlayers = await allPlayersQuery();
  if (!allPlayers.length) {
    return { player: null, matchType: 'none', reason: 'not_found', phone: normalizedPhone };
  }

  const idMatches = allPlayers.filter((player) =>
    String(player.id ?? '').toLowerCase().startsWith(rawIdentifier.toLowerCase())
  );
  if (idMatches.length === 1) {
    return { player: idMatches[0], matchType: 'id-prefix', reason: 'ok', phone: idMatches[0].phone ?? '' };
  }
  if (idMatches.length > 1) {
    return { player: null, matchType: 'id-prefix', reason: 'ambiguous', phone: normalizedPhone };
  }

  const startsWithMatches = allPlayers.filter((player) =>
    normalizeText(player.username).startsWith(normalizedIdentifier)
  );
  if (startsWithMatches.length === 1) {
    return {
      player: startsWithMatches[0],
      matchType: 'username-prefix',
      reason: 'ok',
      phone: startsWithMatches[0].phone ?? '',
    };
  }
  if (startsWithMatches.length > 1) {
    return { player: null, matchType: 'username-prefix', reason: 'ambiguous', phone: normalizedPhone };
  }

  const containsMatches = allPlayers.filter((player) =>
    normalizeText(player.username).includes(normalizedIdentifier)
  );
  if (containsMatches.length === 1) {
    return {
      player: containsMatches[0],
      matchType: 'username-contains',
      reason: 'ok',
      phone: containsMatches[0].phone ?? '',
    };
  }
  if (containsMatches.length > 1) {
    return { player: null, matchType: 'username-contains', reason: 'ambiguous', phone: normalizedPhone };
  }

  return { player: null, matchType: 'none', reason: 'not_found', phone: normalizedPhone };
}

export async function verifyAndLinkPlayer(whatsappNumber, searchKey) {
  const phone = normalizePhone(whatsappNumber);
  const normalizedKey = String(searchKey ?? '').trim();

  if (!normalizedKey) {
    return {
      success: false,
      message: '⚠️ Debes ingresar tu nombre de usuario o el código ID de tu perfil de la página web.\nEjemplo: `!verificar Zoelfrost` o `!verificar 2354`'
    };
  }

  // We allow multiple accounts per WhatsApp now.
  // The user can switch between them using !cambiarcuenta

  // 2. Search for the target player
  // First attempt: search by exact username (case-insensitive)
  let { data: targetPlayer, error: userErr } = await supabase
    .from('players')
    .select(PLAYER_IDENTITY_COLUMNS)
    .ilike('username', normalizedKey)
    .maybeSingle();

  // Second attempt: search by UUID prefix
  if (!targetPlayer && normalizedKey.length >= 4) {
    const { data: allPlayers, error: allErr } = await supabase
      .from('players')
      .select(PLAYER_IDENTITY_COLUMNS);

    if (allPlayers) {
      const matches = allPlayers.filter(p => 
        p.id.toLowerCase().startsWith(normalizedKey.toLowerCase())
      );
      if (matches.length === 1) {
        targetPlayer = matches[0];
      } else if (matches.length > 1) {
        return {
          success: false,
          message: `⚠️ Se encontraron múltiples aventureros que coinciden con el código *${normalizedKey}*. Por favor escribe un código más completo.`
        };
      }
    }
  }

  if (!targetPlayer) {
    return {
      success: false,
      message: `❌ No se encontró ningún aventurero con el usuario o código *${normalizedKey}* en los registros del Reino.`
    };
  }

  // 3. Check if the target player already has a phone linked
  if (targetPlayer.phone) {
    if (targetPlayer.phone.includes(phone)) {
      return {
        success: true,
        message: `🛡️ Tu cuenta ya está vinculada de manera segura con el aventurero *${targetPlayer.username}*.`
      };
    }
    return {
      success: false,
      message: `❌ El aventurero *${targetPlayer.username}* ya está vinculado a otro número de WhatsApp.`
    };
  }

  // 4. Link by updating phone and last_active_at columns
  const { error: updateErr } = await supabase
    .from('players')
    .update({ 
      phone,
      last_active_at: new Date().toISOString()
    })
    .eq('id', targetPlayer.id);

  if (updateErr) {
    console.error('[verifyAndLinkPlayer] update error:', updateErr.message);
    return {
      success: false,
      message: '⚔️ El Archivista del Reino tuvo un problema al sellar tu vinculación. Inténtalo más tarde.'
    };
  }

  return {
    success: true,
    message: `🎉 ¡Vinculación exitosa!\n\n🛡️ El aventurero *${targetPlayer.username}* ahora está vinculado a tu WhatsApp.\n💰 Oro actual: *${targetPlayer.gold}*\n\n¡Ya puedes usar todos los comandos del bot con tu cuenta de la página web!`
  };
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
      supabase.from('players').select('id', { count: 'exact', head: true }),
      supabase.from('market_items').select('id', { count: 'exact', head: true }).neq('stock_status', 'sold-out'),
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

export async function getLinkStatusByWhatsapp(whatsappNumber) {
  const players = await getPlayersByPhone(whatsappNumber);
  return {
    phone: normalizePhone(whatsappNumber),
    linked: players.length > 0,
    player: players[0] ?? null,
    players,
    multipleProfiles: players.length > 1,
  };
}

export async function getStaffSnapshot() {
  const [{ count: totalPlayers }, { count: linkedPlayers }, { count: totalSheets }, missions, events, richBoard] =
    await Promise.all([
      supabase.from('players').select('id', { count: 'exact', head: true }),
      supabase.from('players').select('id', { count: 'exact', head: true }).not('phone', 'is', null),
      supabase.from('character_sheets').select('playerId', { count: 'exact', head: true }),
      getActiveMissions(10),
      getActiveEvents(10),
      getGoldLeaderboard(3),
    ]);

  return {
    totalPlayers: totalPlayers ?? 0,
    linkedPlayers: linkedPlayers ?? 0,
    totalSheets: totalSheets ?? 0,
    openMissions: missions.length,
    activeEvents: events.length,
    richestPlayers: richBoard,
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
  const { data, error } = await supabase.rpc('increment_gold', {
    p_player_id: playerId,
    p_amount: Math.trunc(amount),
  });

  if (error) {
    console.error('[updateGold]', error.message);
    throw new Error('No se pudo actualizar el oro.');
  }

  if (Array.isArray(data) && data[0] && !data[0].success) {
    console.error('[updateGold] Logic Error:', data[0].message);
    throw new Error(data[0].message || 'No se pudo actualizar el oro.');
  }
}

export async function awardManualMissionRankPoints({
  playerIds,
  difficulty,
  awardedByName,
  awardedByPhone = null,
  notes = '',
  externalRef = null,
}) {
  const uniquePlayerIds = [...new Set((playerIds ?? []).filter(Boolean))];

  if (!uniquePlayerIds.length) {
    throw new Error('No se recibieron jugadores para premiar.');
  }

  const { data, error } = await supabase.rpc('award_manual_mission_rank_points', {
    p_player_ids: uniquePlayerIds,
    p_difficulty: difficulty,
    p_awarded_by_name: awardedByName,
    p_awarded_by_phone: awardedByPhone,
    p_notes: notes,
    p_external_ref: externalRef,
  });

  if (error) {
    console.error('[awardManualMissionRankPoints]', error.message);
    throw new Error(error.message || 'No se pudieron asignar puntos de mision.');
  }

  return Array.isArray(data) ? data[0] ?? null : data ?? null;
}

export async function createTreasureEvent({ chatId, messageId, maxWinners, expiresAt }) {
  const { data, error } = await botStateSupabase
    .from('bot_treasure_events')
    .insert({
      chat_id: chatId,
      message_id: messageId,
      max_winners: maxWinners,
      status: 'open',
      expires_at: expiresAt,
    })
    .select('id, chat_id, message_id, max_winners, status, created_at, expires_at')
    .single();

  if (error) {
    console.error('[createTreasureEvent]', error.message);
    throw new Error('No se pudo crear el evento de tesoro.');
  }

  return data;
}

export async function getOpenTreasureEvents(chatId = null) {
  let query = botStateSupabase
    .from('bot_treasure_events')
    .select('id, chat_id, message_id, max_winners, status, created_at, expires_at')
    .eq('status', 'open')
    .order('created_at', { ascending: true });

  if (chatId) {
    query = query.eq('chat_id', chatId);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[getOpenTreasureEvents]', error.message);
    throw new Error('No se pudieron leer los tesoros abiertos.');
  }

  return data ?? [];
}

export async function expireTreasureEvent(messageId) {
  const { data, error } = await botStateSupabase
    .from('bot_treasure_events')
    .update({
      status: 'expired',
      closed_at: new Date().toISOString(),
    })
    .eq('message_id', messageId)
    .eq('status', 'open')
    .select('id, chat_id, message_id, max_winners, status, created_at, expires_at, closed_at')
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('[expireTreasureEvent]', error.message);
    throw new Error('No se pudo expirar el tesoro.');
  }

  return data ?? null;
}

export async function getTreasureClaims(messageId) {
  const { data: claims, error } = await botStateSupabase
    .from('bot_treasure_claims')
    .select('player_id, reward_gold, claimed_at')
    .eq('event_message_id', messageId)
    .order('claimed_at', { ascending: true });

  if (error) {
    console.error('[getTreasureClaims]', error.message);
    throw new Error('No se pudieron leer los claims del tesoro.');
  }

  if (!claims || claims.length === 0) return [];

  const playerIds = claims.map((c) => c.player_id);
  const { data: players } = await supabase
    .from('players')
    .select('id, username')
    .in('id', playerIds);

  const playerMap = {};
  if (players) {
    players.forEach((p) => { playerMap[p.id] = p.username; });
  }

  return claims.map((claim) => ({
    playerName: playerMap[claim.player_id] || 'Jugador Desconocido',
    rewardGold: claim.reward_gold,
    claimedAt: claim.claimed_at,
  }));
}

export async function claimTreasureReward(messageId, playerId, chatId) {
  // Configurar la recompensa entre 1000 y 20000
  const rewardGold = Math.floor(Math.random() * (20000 - 1000 + 1)) + 1000;

  // Primero verificar el evento y los ganadores actuales
  const { data: event, error: eventError } = await botStateSupabase
    .from('bot_treasure_events')
    .select('max_winners, status, expires_at')
    .eq('message_id', messageId)
    .single();

  if (eventError || !event) {
    return { status: 'error' };
  }

  if (event.status !== 'open') {
    return { status: 'full' };
  }

  if (new Date(event.expires_at).getTime() < Date.now()) {
    return { status: 'expired' };
  }

  const { count: currentCount } = await botStateSupabase
    .from('bot_treasure_claims')
    .select('*', { count: 'exact', head: true })
    .eq('event_message_id', messageId);

  if (currentCount >= event.max_winners) {
    return { status: 'full' };
  }

  const { data: claim, error: claimError } = await botStateSupabase
    .from('bot_treasure_claims')
    .insert({
      event_message_id: messageId,
      player_id: playerId,
      reward_gold: rewardGold,
    })
    .select('id')
    .maybeSingle();

  if (claimError) {
    if (claimError.code === '23505') return { status: 'duplicate' };
    console.error('[claimTreasureReward]', claimError.message);
    return { status: 'error' };
  }

  try {
    await updateGold(playerId, rewardGold);
  } catch (goldError) {
    await botStateSupabase.from('bot_treasure_claims').delete().eq('id', claim.id);
    console.error('[claimTreasureReward.rollback]', goldError.message);
    return { status: 'error' };
  }

  const newCount = currentCount + 1;
  const isFull = newCount >= event.max_winners;

  if (isFull) {
    await botStateSupabase
      .from('bot_treasure_events')
      .update({ status: 'closed', closed_at: new Date().toISOString() })
      .eq('message_id', messageId);
  }

  return { 
    status: 'ok', 
    reward_gold: rewardGold,
    winners_count: newCount,
    max_winners: event.max_winners,
    event_status: isFull ? 'claimed' : 'open'
  };
}

export async function claimDailyReward(playerId, rewardGold) {
  const claimDate = formatAsuncionDateKey();
  const safeRewardGold = Math.max(0, Number(rewardGold) || 0);
  const { data, error } = await botStateSupabase
    .from('bot_daily_claims')
    .insert({
      player_id: playerId,
      claim_type: DAILY_CLAIM_TYPE,
      claim_date: claimDate,
      reward_gold: safeRewardGold,
    })
    .select(BOT_STATE_SELECT_COLUMNS)
    .single();

  if (error) {
    const duplicateLike =
      error.code === '23505' || String(error.message ?? '').toLowerCase().includes('duplicate');
    if (duplicateLike) {
      return false;
    }

    console.error('[claimDailyReward]', error.message);
    throw new Error('No se pudo registrar la recompensa diaria.');
  }

  try {
    await updateGold(playerId, safeRewardGold);
    return Boolean(data);
  } catch (goldError) {
    const { error: rollbackError } = await botStateSupabase
      .from('bot_daily_claims')
      .delete()
      .eq('id', data.id);

    if (rollbackError) {
      console.error('[claimDailyReward.rollback]', rollbackError.message);
    }

    throw goldError;
  }
}

export async function hasClaimedDailyReward(playerId) {
  const claimDate = formatAsuncionDateKey();
  const { data, error } = await botStateSupabase
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

export async function getDadosUsage(playerId) {
  return getBotUsageCount(playerId, 'dados_usage', 'getDadosUsage');
}

export async function incrementDadosUsage(playerId, amount = 1) {
  return incrementBotUsageCount(playerId, 'dados_usage', getDadosUsage, 'incrementDadosUsage', amount);
}

export async function getBlackjackUsage(playerId) {
  return getBotUsageCount(playerId, 'blackjack_usage', 'getBlackjackUsage');
}

export async function incrementBlackjackUsage(playerId) {
  return incrementBotUsageCount(playerId, 'blackjack_usage', getBlackjackUsage, 'incrementBlackjackUsage');
}

export async function getCofreUsage(playerId) {
  return getBotUsageCount(playerId, 'cofre_usage', 'getCofreUsage');
}

export async function incrementCofreUsage(playerId, amount = 1) {
  return incrementBotUsageCount(playerId, 'cofre_usage', getCofreUsage, 'incrementCofreUsage', amount);
}

export async function getTrampaUsage(playerId) {
  return getBotUsageCount(playerId, 'trampa_usage', 'getTrampaUsage');
}

export async function incrementTrampaUsage(playerId, amount = 1) {
  return incrementBotUsageCount(playerId, 'trampa_usage', getTrampaUsage, 'incrementTrampaUsage', amount);
}

function buildRestrictedGroupViolationPrefix(scopeKey = 'main') {
  return `grpviol.${String(scopeKey || 'main').trim().toLowerCase()}`;
}

function buildRestrictedGroupViolationClaimType(scopeKey, strikeNumber, commandName) {
  const safeStrike = String(Math.max(1, Number(strikeNumber) || 1)).padStart(4, '0');
  const safeCommand = String(commandName || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';

  return `${buildRestrictedGroupViolationPrefix(scopeKey)}.${safeStrike}.${safeCommand}`;
}

function parseRestrictedGroupViolationRow(row, scopeKey) {
  const prefix = `${buildRestrictedGroupViolationPrefix(scopeKey)}.`;
  const claimType = String(row?.claim_type ?? '');

  if (!claimType.startsWith(prefix)) {
    return null;
  }

  const [, rawStrike = '0', commandName = 'unknown'] = claimType.slice(prefix.length).split('.');
  const strikeNumber = Number.parseInt(rawStrike, 10);

  return {
    strikeNumber: Number.isFinite(strikeNumber) ? strikeNumber : 0,
    commandName,
    penaltyGold: Number(row?.reward_gold ?? 0),
    createdAt: row?.created_at ?? null,
    warningOnly: Number(row?.reward_gold ?? 0) <= 0,
  };
}

export async function getRestrictedGroupCommandViolationsForDay(playerId, scopeKey = 'main') {
  const claimDate = formatAsuncionDateKey();
  const prefix = `${buildRestrictedGroupViolationPrefix(scopeKey)}.%`;
  const { data, error } = await botStateSupabase
    .from('bot_daily_claims')
    .select('claim_type, reward_gold, created_at')
    .eq('player_id', playerId)
    .eq('claim_date', claimDate)
    .like('claim_type', prefix)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getRestrictedGroupCommandViolationsForDay]', error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => parseRestrictedGroupViolationRow(row, scopeKey))
    .filter(Boolean)
    .sort((left, right) => left.strikeNumber - right.strikeNumber);
}

export async function getRestrictedGroupCommandSummaryForDay(playerId, scopeKey = 'main') {
  const entries = await getRestrictedGroupCommandViolationsForDay(playerId, scopeKey);

  return {
    count: entries.length,
    totalPenaltyGold: entries.reduce((total, entry) => total + Math.max(0, Number(entry.penaltyGold ?? 0)), 0),
    entries,
  };
}

export async function recordRestrictedGroupCommandViolation({
  playerId,
  scopeKey = 'main',
  commandName,
  penaltyGold = 0,
}) {
  const claimDate = formatAsuncionDateKey();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existingEntries = await getRestrictedGroupCommandViolationsForDay(playerId, scopeKey);
    const nextStrikeNumber = existingEntries.length + 1;
    const claimType = buildRestrictedGroupViolationClaimType(scopeKey, nextStrikeNumber, commandName);

    const { error } = await botStateSupabase
      .from('bot_daily_claims')
      .insert({
        player_id: playerId,
        claim_type: claimType,
        claim_date: claimDate,
        reward_gold: Math.max(0, Number(penaltyGold) || 0),
      });

    if (!error) {
      return {
        strikeNumber: nextStrikeNumber,
        commandName,
        penaltyGold: Math.max(0, Number(penaltyGold) || 0),
        warningOnly: Math.max(0, Number(penaltyGold) || 0) <= 0,
      };
    }

    const conflictLike = error.code === '23505' || String(error.message ?? '').toLowerCase().includes('duplicate');
    if (!conflictLike) {
      console.error('[recordRestrictedGroupCommandViolation]', error.message);
      throw new Error('No se pudo registrar la falta del grupo.');
    }
  }

  throw new Error('No se pudo blindar el registro de la falta del grupo.');
}

async function getBotUsageCount(playerId, claimType, logLabel) {
  const claimDate = formatAsuncionDateKey();
  const { data, error } = await botStateSupabase
    .from('bot_daily_claims')
    .select('reward_gold')
    .eq('player_id', playerId)
    .eq('claim_type', claimType)
    .eq('claim_date', claimDate)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error(`[${logLabel}]`, error.message);
  }

  return data ? data.reward_gold : 0;
}

async function incrementBotUsageCount(playerId, claimType, getCurrentUsage, logLabel, amount = 1) {
  const claimDate = formatAsuncionDateKey();
  const current = await getCurrentUsage(playerId);

  const { error } = await botStateSupabase
    .from('bot_daily_claims')
    .upsert({
      player_id: playerId,
      claim_type: claimType,
      claim_date: claimDate,
      reward_gold: current + amount
    }, { onConflict: 'player_id, claim_type, claim_date' });

  if (error) {
    console.error(`[${logLabel}]`, error.message);
  }
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

/**
 * Obtiene el censo de todos los jugadores y sus fichas para reportes de administración.
 */
export async function getRealmCensus() {
  const { data: players, error: playErr } = await supabase
    .from('players')
    .select('id, username, phone, created_at')
    .order('username', { ascending: true });

  if (playErr) {
    console.error('[getRealmCensus] players error:', playErr.message);
    throw new Error('Error al obtener censo de jugadores.');
  }

  const { data: sheets, error: sheetErr } = await supabase
    .from('character_sheets')
    .select('playerId, name');

  if (sheetErr) {
    console.error('[getRealmCensus] sheets error:', sheetErr.message);
    throw new Error('Error al obtener censo de personajes.');
  }

  return { players: players ?? [], sheets: sheets ?? [] };
}

let knowledgeCache = null;
let knowledgeCacheExpiresAt = 0;
const KNOWLEDGE_CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutos

export async function getKnowledgeDocuments() {
  const now = Date.now();
  if (knowledgeCache && now < knowledgeCacheExpiresAt) {
    return knowledgeCache;
  }

  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, title, type, category, tags, source, content, summary, visible')
    .eq('visible', true);

  if (error) {
    console.error('[getKnowledgeDocuments]', error.message);
    return [];
  }
  
  knowledgeCache = data || [];
  knowledgeCacheExpiresAt = now + KNOWLEDGE_CACHE_TTL_MS;
  return knowledgeCache;
}

export function slugifyKnowledgeId(value, fallback = "documento") {
  const slug = value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

  return slug || fallback;
}

export async function upsertKnowledgeDocument(doc) {
  const payload = {
    id: doc.id || slugifyKnowledgeId(doc.title),
    title: doc.title,
    type: doc.type || 'other',
    category: doc.category || 'bot',
    tags: doc.tags || [],
    source: doc.source || 'whatsapp-bot',
    content: doc.content,
    summary: doc.summary || '',
    visible: doc.visible !== undefined ? doc.visible : true,
  };

  const { error } = await supabase
    .from('knowledge_documents')
    .upsert(payload, { onConflict: 'id' });

  if (error) {
    console.error('[upsertKnowledgeDocument]', error.message);
    return false;
  }
  
  knowledgeCache = null;
  return true;
}

export function pickKnowledgeContext(documents, question, maxDocuments = 3) {
  const tokens = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length > 2);

  const scored = documents.map((document) => {
    const title = document.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const metadata = `${document.type} ${document.category} ${(document.tags || []).join(" ")} ${document.source} ${document.summary}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const content = document.content
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
      
    const score = tokens.reduce((total, token) => {
      const titleHit = title.includes(token) ? 6 : 0;
      const metadataHit = metadata.includes(token) ? 3 : 0;
      const contentHit = content.includes(token) ? 1 : 0;
      return total + titleHit + metadataHit + contentHit;
    }, 0);

    return { document, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .filter((entry, index) => entry.score > 0 || index < 1) // Always keep at least 1 document if nothing matches perfectly, or maybe only if score > 0? Let's just keep score > 0.
    .filter(entry => entry.score > 0)
    .slice(0, maxDocuments)
    .map((entry) => entry.document);
}

export async function getPlayerSheet(playerId) {
  if (!playerId) return null;
  const { data, error } = await supabase
    .from('character_sheets')
    .select('name, race, powers, weapon, birthRealm, personality')
    .eq('playerId', playerId)
    .limit(1)
    .maybeSingle();
    
  if (error) {
    console.error('[getPlayerSheet] Error fetching sheet:', error.message);
    return null;
  }
  return data;
}

export async function getPlayerInventory(playerId) {
  if (!playerId) return null;
  const { data, error } = await supabase
    .from('player_inventory')
    .select('item_id, item_name, quantity, item_category')
    .eq('player_id', playerId);
    
  if (error) {
    console.error('[getPlayerInventory] Error fetching inventory:', error.message);
    return null;
  }
  return data;
}

export async function touchPlayerActivity(playerId) {
  if (!playerId) return false;
  const { error } = await supabase
    .from('players')
    .update({ last_active_at: new Date().toISOString() })
    .eq('id', playerId);
    
  if (error) {
    console.error('[touchPlayerActivity] Error:', error.message);
    return false;
  }
  return true;
}

export async function getActivityReport() {
  const { data, error } = await supabase
    .from('players')
    .select('username, last_active_at, phone')
    .order('last_active_at', { ascending: false, nullsLast: true });

  if (error) {
    console.error('[getActivityReport]', error.message);
    throw new Error('Error al obtener el reporte de actividad.');
  }

  return data ?? [];
}

export async function getMissionByShortId(prefix) {
  if (!prefix) return null;
  const { data, error } = await supabase
    .from('realm_missions')
    .select('id, title, instructions');

  if (error) {
    console.error('[getMissionByShortId]', error.message);
    return null;
  }

  if (!data) return null;

  const normalizedPrefix = prefix.toLowerCase();
  const match = data.find(m => m.id.toLowerCase().startsWith(normalizedPrefix));
  return match || null;
}

// Las funciones getMissionsWithMissingNotebooks / updateMissionNotebookId se
// eliminaron junto con la integracion NotebookLM (sin callers). La columna
// notebook_id sigue existiendo en la BD pero el bot ya no la usa.

export async function getFormattedGrimoire() {
  const { data, error } = await supabase
    .from('grimoire_magic_styles')
    .select('category_title, title, description, levels')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getFormattedGrimoire] Error fetching:', error.message);
    return '';
  }

  if (!data || data.length === 0) return 'No hay magias registradas en el grimorio.';

  let text = `# GRIMORIO OFICIAL DE MAGIAS Y HECHIZOS DEL REINO\n\n`;
  text += `Este documento contiene la lista canónica de escuelas de magia, hechizos, niveles, cooldowns (CD), límites y efectos. El GM debe apegarse estrictamente a esta lista para juzgar el uso de magia por parte de los jugadores.\n\n`;

  for (const style of data) {
    text += `=========================================\n`;
    text += `ESCUELA MÁGICA: ${style.title} (${style.category_title || 'General'})\n`;
    text += `=========================================\n`;
    text += `${style.description || 'Sin descripción.'}\n\n`;

    if (style.levels && typeof style.levels === 'object') {
      for (const [lvl, spells] of Object.entries(style.levels)) {
        text += `### NIVEL ${lvl}\n`;
        if (Array.isArray(spells)) {
          for (const spell of spells) {
            text += `- **Nombre:** ${spell.name || 'Sin nombre'}\n`;
            text += `  - **Cooldown (CD):** ${spell.cd || 'No especificado'}\n`;
            text += `  - **Límite/Condición:** ${spell.limit || 'Ninguno'}\n`;
            text += `  - **Efecto:** ${spell.effect || 'No especificado'}\n`;
            if (spell.antiManoNegra) {
              text += `  - **Contra-medida (Anti-Mano Negra):** ${spell.antiManoNegra}\n`;
            }
            text += `\n`;
          }
        } else {
          text += `(No hay hechizos declarados para este nivel)\n\n`;
        }
      }
    }
    text += `\n`;
  }

  return text;
}

export async function getFormattedEncyclopedia() {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('title, type, category, content')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getFormattedEncyclopedia] Error fetching:', error.message);
    return '';
  }

  if (!data || data.length === 0) return 'No hay documentos de lore registrados en la enciclopedia.';

  let text = `# ENCICLOPEDIA, LORE Y CODEX DEL REINO\n\n`;
  text += `Este documento contiene la historia oficial, facciones, geopolítica, razas y el reglamento del sistema de combate del reino de KingDoom. El GM debe usar esta información para dar consistencia y coherencia a la narrativa.\n\n`;

  for (const doc of data) {
    text += `=========================================\n`;
    text += `DOCUMENTO: ${doc.title} [Tipo: ${doc.type || 'General'} | Categoría: ${doc.category || 'Lore'}]\n`;
    text += `=========================================\n\n`;
    text += `${doc.content || 'Sin contenido.'}\n\n`;
    text += `\n`;
  }

  return text;
}

export async function saveActiveMissionState(state) {
  const payload = {
    short_id: state.shortId,
    mission_id: state.id,
    title: state.title,
    instructions: state.instructions,
    gm_config: state.gmConfig,
    max_participants: state.maxParticipants,
    player_message_count: state.playerMessageCount,
    gm_round_count: state.gmRoundCount,
    context: state.context,
    participants_counted: Array.from(state.participantsCounted || []),
    resolved: state.resolved,
    final_state: state.finalState
  };

  const { error } = await botStateSupabase
    .from('bot_active_missions')
    .upsert(payload, { onConflict: 'short_id' });

  if (error) {
    console.error('[saveActiveMissionState] Error saving mission state:', error.message);
  }
}

export async function getActiveMissionsFromDb() {
  const { data, error } = await botStateSupabase
    .from('bot_active_missions')
    .select('*')
    .eq('resolved', false);

  if (error) {
    console.error('[getActiveMissionsFromDb] Error fetching active missions:', error.message);
    return [];
  }
  return data ?? [];
}

export async function deleteResolvedMission(shortId) {
  const { error } = await botStateSupabase
    .from('bot_active_missions')
    .delete()
    .eq('short_id', shortId);

  if (error) {
    console.error('[deleteResolvedMission] Error deleting resolved mission:', error.message);
  }
}

export async function processMarketInstallments() {
  const { data, error } = await supabase.rpc('process_market_installments');
  if (error) {
    console.error('[processMarketInstallments] Error:', error.message);
    throw new Error('No se pudieron procesar las cuotas.');
  }
  return data;
}

