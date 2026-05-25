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

export async function getPlayersByPhone(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  if (!phone) return [];

  const { data, error } = await supabase
    .from('players')
    .select('*')
    .ilike('phone', `%${phone}%`)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[getPlayersByPhone]', error.message);
    return [];
  }

  return data ?? [];
}

export async function getPlayer(whatsappNumber) {
  const players = await getPlayersByPhone(whatsappNumber);
  return players[0] ?? null;
}

export async function findPlayerByIdentifier(identifier) {
  const rawIdentifier = String(identifier ?? '').trim();
  if (!rawIdentifier) {
    return { player: null, matchType: 'none', reason: 'missing', phone: '' };
  }

  const normalizedIdentifier = normalizeText(rawIdentifier);
  const normalizedPhone = normalizePhone(rawIdentifier);
  const allPlayersQuery = async () => {
    const { data, error } = await supabase.from('players').select('*');
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
    .select('*')
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

  // 1. Check if this WhatsApp is already linked to some player
  const alreadyLinkedPlayers = await getPlayersByPhone(phone);
  if (alreadyLinkedPlayers.length > 1) {
    const usernames = alreadyLinkedPlayers
      .map((player) => player.username)
      .filter(Boolean)
      .join(', ');
    return {
      success: false,
      message: `❌ Tu WhatsApp ya está vinculado a varias cuentas del reino: *${usernames}*.\nPídele al Soberano que ordene o depure tus vínculos antes de volver a verificar.`
    };
  }

  const alreadyLinked = alreadyLinkedPlayers[0];
  if (alreadyLinked) {
    return {
      success: false,
      message: `❌ Tu WhatsApp ya está vinculado al aventurero *${alreadyLinked.username}*.\nSi deseas cambiar de cuenta, pídele ayuda al Soberano.`
    };
  }

  // 2. Search for the target player
  // First attempt: search by exact username (case-insensitive)
  let { data: targetPlayer, error: userErr } = await supabase
    .from('players')
    .select('*')
    .ilike('username', normalizedKey)
    .maybeSingle();

  // Second attempt: search by UUID prefix
  if (!targetPlayer && normalizedKey.length >= 4) {
    const { data: allPlayers, error: allErr } = await supabase
      .from('players')
      .select('*');

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

  // 4. Link by updating phone column
  const { error: updateErr } = await supabase
    .from('players')
    .update({ phone })
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
      supabase.from('players').select('*', { count: 'exact', head: true }),
      supabase.from('market_items').select('*', { count: 'exact', head: true }).neq('stock_status', 'sold-out'),
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
      supabase.from('players').select('*', { count: 'exact', head: true }),
      supabase.from('players').select('*', { count: 'exact', head: true }).not('phone', 'is', null),
      supabase.from('character_sheets').select('*', { count: 'exact', head: true }),
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

export async function getDadosUsage(playerId) {
  const claimDate = formatAsuncionDateKey();
  const { data, error } = await supabase
    .from('bot_daily_claims')
    .select('reward_gold')
    .eq('player_id', playerId)
    .eq('claim_type', 'dados_usage')
    .eq('claim_date', claimDate)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('[getDadosUsage]', error.message);
  }

  return data ? data.reward_gold : 0;
}

export async function incrementDadosUsage(playerId) {
  const claimDate = formatAsuncionDateKey();
  const current = await getDadosUsage(playerId);
  
  const { error } = await supabase
    .from('bot_daily_claims')
    .upsert({
      player_id: playerId,
      claim_type: 'dados_usage',
      claim_date: claimDate,
      reward_gold: current + 1
    }, { onConflict: 'player_id, claim_type, claim_date' });
    
  if (error) {
    console.error('[incrementDadosUsage]', error.message);
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

export async function getKnowledgeDocuments() {
  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id, title, type, category, tags, source, content, summary, visible')
    .eq('visible', true);

  if (error) {
    console.error('[getKnowledgeDocuments]', error.message);
    return [];
  }
  return data || [];
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
