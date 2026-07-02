import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { normalizePhone, isAdminUser, isStaffUser, isOwner } from './adminStore.js';
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
const KNOWLEDGE_CONTENT_MODE = String(process.env.KNOWLEDGE_CONTENT_MODE ?? 'full').toLowerCase();
const PLAYER_SELECT_COLUMNS = 'id, username, gold, weekly_gold, phone, is_admin, banned, created_at, last_active_at';
const PLAYER_IDENTITY_COLUMNS = 'id, username, gold, weekly_gold, phone, is_admin, banned';
const PLAYER_LIFECYCLE_SELECT_COLUMNS = 'id, username, phone, lifecycle_status, left_group_at, archive_due_at, archived_at, reactivated_at, recycled_at, purged_at';
const phoneLookupCache = new Map();
const BOT_STATE_SELECT_COLUMNS = 'id, claim_type, claim_date, reward_gold, created_at';
let missionPrefixFilterSupported = true;
const PLAYER_LIFECYCLE_GRACE_DAYS = Math.max(
  1,
  Number.parseInt(process.env.PLAYER_LIFECYCLE_GRACE_DAYS ?? '14', 10) || 14
);
const ROLEPLAY_LOCK_AFTER_DAYS = Math.max(
  1,
  Number.parseInt(process.env.ROLEPLAY_LOCK_AFTER_DAYS ?? '9', 10) || 9
);
const ROLEPLAY_INITIAL_GRACE_DAYS = Math.max(
  1,
  Number.parseInt(process.env.ROLEPLAY_INITIAL_GRACE_DAYS ?? '9', 10) || 9
);
const ROLEPLAY_SELECT_COLUMNS = 'player_id, last_roleplay_at, grace_until, locked_at, lock_reason, last_roleplay_group_jid, last_human_roleplay_phone, is_exempt, exempt_reason, created_at, updated_at';

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

function readEnv(...names) {
  for (const name of names) {
    const value = String(process.env[name] ?? '').trim();
    if (value) return value;
  }
  return '';
}

function requireEnv(value, label, aliases) {
  if (value) return value;
  throw new Error(
    `${label} is required. Configure one of: ${aliases.join(', ')}`
  );
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

const primarySupabaseUrl = readEnv(
  'SUPABASE_URL',
  'SUPABASE_PROJECT_URL',
  'NEXT_PUBLIC_SUPABASE_URL'
);
const primarySupabaseServiceKey = readEnv(
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY'
);

export const supabase = createServiceClient(
  requireEnv(primarySupabaseUrl, 'supabaseUrl', [
    'SUPABASE_URL',
    'SUPABASE_PROJECT_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
  ]),
  requireEnv(primarySupabaseServiceKey, 'supabaseServiceKey', [
    'SUPABASE_SERVICE_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ])
);

const botStateSupabaseUrl =
  readEnv('BOT_SUPABASE_URL', 'BOT_SUPABASE_PROJECT_URL') || primarySupabaseUrl;
const botStateSupabaseServiceKey =
  readEnv('BOT_SUPABASE_SERVICE_KEY', 'BOT_SUPABASE_SERVICE_ROLE_KEY') || primarySupabaseServiceKey;

export const botStateSupabase = createServiceClient(
  botStateSupabaseUrl,
  botStateSupabaseServiceKey
);

export const usingDedicatedBotStateSupabase = Boolean(
  readEnv('BOT_SUPABASE_URL', 'BOT_SUPABASE_PROJECT_URL')
  && readEnv('BOT_SUPABASE_SERVICE_KEY', 'BOT_SUPABASE_SERVICE_ROLE_KEY')
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

function isMissingLifecycleSchemaError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? '');
  return code === '42703' ||
    message.includes('lifecycle_status') ||
    message.includes('left_group_at') ||
    message.includes('archive_due_at') ||
    message.includes('player_lifecycle_log');
}

function buildPlayerLifecycleSchemaError() {
  return new Error(
    'El SQL de player lifecycle aun no esta aplicado. Ejecuta supabase_player_lifecycle.sql en el proyecto principal de Supabase.'
  );
}

function isMissingRoleplaySchemaError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? '');
  return code === '42P01' ||
    code === '42703' ||
    message.includes('player_roleplay_access') ||
    message.includes('roleplay_phone_activity') ||
    message.includes('last_roleplay_at') ||
    message.includes('grace_until') ||
    message.includes('locked_at');
}

function buildRoleplaySchemaError() {
  return new Error(
    'El SQL de roleplay access aun no esta aplicado. Ejecuta supabase_roleplay_access.sql en el proyecto principal de Supabase.'
  );
}

function computeRoleplayInitialGraceUntil(referenceDate = new Date()) {
  return new Date(
    referenceDate.getTime() + ROLEPLAY_INITIAL_GRACE_DAYS * 24 * 60 * 60 * 1000
  );
}

function computeRoleplayExemption(player) {
  const phone = normalizePhone(player?.phone ?? '');
  const isExempt = Boolean(player?.is_admin) || isOwner(phone) || isAdminUser(phone) || isStaffUser(phone);

  if (!isExempt) {
    return { isExempt: false, exemptReason: null };
  }

  if (player?.is_admin) {
    return { isExempt: true, exemptReason: 'player_is_admin' };
  }
  if (isOwner(phone)) {
    return { isExempt: true, exemptReason: 'owner_phone' };
  }
  if (isAdminUser(phone)) {
    return { isExempt: true, exemptReason: 'admin_phone' };
  }
  return { isExempt: true, exemptReason: 'staff_phone' };
}

async function insertRoleplayAccessLog(entries) {
  if (!entries.length) return;

  const { error } = await supabase
    .from('player_roleplay_access_log')
    .insert(entries);

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[insertRoleplayAccessLog]', error.message);
    throw new Error('No se pudo registrar la auditoria de roleplay.');
  }
}

async function getRoleplayAccessMap(playerIds) {
  const safePlayerIds = [...new Set((playerIds ?? []).map((entry) => String(entry ?? '').trim()).filter(Boolean))];
  if (!safePlayerIds.length) {
    return new Map();
  }

  const { data, error } = await supabase
    .from('player_roleplay_access')
    .select(ROLEPLAY_SELECT_COLUMNS)
    .in('player_id', safePlayerIds);

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[getRoleplayAccessMap]', error.message);
    throw new Error('No se pudo leer el estado de roleplay.');
  }

  return new Map((data ?? []).map((entry) => [entry.player_id, entry]));
}

async function seedRoleplayAccessForPlayers(players) {
  const safePlayers = (players ?? []).filter((player) => player?.id);
  if (!safePlayers.length) return 0;

  const now = new Date();
  const graceUntil = computeRoleplayInitialGraceUntil(now).toISOString();
  const rows = safePlayers.map((player) => {
    const { isExempt, exemptReason } = computeRoleplayExemption(player);
    return {
      player_id: player.id,
      grace_until: graceUntil,
      is_exempt: isExempt,
      exempt_reason: exemptReason,
    };
  });

  const { error } = await supabase
    .from('player_roleplay_access')
    .upsert(rows, { onConflict: 'player_id', ignoreDuplicates: true });

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[seedRoleplayAccessForPlayers]', error.message);
    throw new Error('No se pudo sembrar el estado de roleplay.');
  }

  return rows.length;
}

async function syncRoleplayExemptionsForPlayers(players, currentAccessMap, actor = 'system:roleplay_sync') {
  const updates = [];
  const logs = [];

  for (const player of players ?? []) {
    if (!player?.id) continue;
    const access = currentAccessMap.get(player.id);
    if (!access) continue;

    const { isExempt, exemptReason } = computeRoleplayExemption(player);
    const exemptionChanged =
      Boolean(access.is_exempt) !== isExempt ||
      String(access.exempt_reason ?? '') !== String(exemptReason ?? '');

    if (!exemptionChanged) continue;

    updates.push({
      player_id: player.id,
      is_exempt: isExempt,
      exempt_reason: exemptReason,
      locked_at: isExempt ? null : access.locked_at ?? null,
      lock_reason: isExempt ? null : access.lock_reason ?? null,
    });

    logs.push({
      player_id: player.id,
      phone: player.phone ?? null,
      action: 'exempt_synced',
      performed_by: actor,
      details: {
        is_exempt: isExempt,
        exempt_reason: exemptReason,
      },
    });
  }

  if (updates.length) {
    const { error } = await supabase
      .from('player_roleplay_access')
      .upsert(updates, { onConflict: 'player_id' });

    if (error) {
      if (isMissingRoleplaySchemaError(error)) {
        throw buildRoleplaySchemaError();
      }
      console.error('[syncRoleplayExemptionsForPlayers]', error.message);
      throw new Error('No se pudo sincronizar la exencion de roleplay.');
    }
  }

  if (logs.length) {
    await insertRoleplayAccessLog(logs);
  }
}

export async function ensureRoleplayAccessSeeded() {
  const { data: players, error } = await supabase
    .from('players')
    .select('id, phone, is_admin');

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[ensureRoleplayAccessSeeded.players]', error.message);
    throw new Error('No se pudo leer la lista de jugadores para sembrar roleplay.');
  }

  await seedRoleplayAccessForPlayers(players ?? []);
  const accessMap = await getRoleplayAccessMap((players ?? []).map((player) => player.id));
  await syncRoleplayExemptionsForPlayers(players ?? [], accessMap, 'system:roleplay_seed');
  return (players ?? []).length;
}

export function getRoleplayLockWindowDays() {
  return ROLEPLAY_LOCK_AFTER_DAYS;
}

export function getRoleplayInitialGraceDays() {
  return ROLEPLAY_INITIAL_GRACE_DAYS;
}

export async function getPlayerRoleplayAccess(playerId) {
  const normalizedPlayerId = String(playerId ?? '').trim();
  if (!normalizedPlayerId) {
    return null;
  }

  const { data, error } = await supabase
    .from('player_roleplay_access')
    .select(ROLEPLAY_SELECT_COLUMNS)
    .eq('player_id', normalizedPlayerId)
    .maybeSingle();

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[getPlayerRoleplayAccess]', error.message);
    throw new Error('No se pudo leer el acceso de roleplay del jugador.');
  }

  return data ?? null;
}

export async function markRoleplayActivityForPhone(whatsappNumber, options = {}) {
  const phone = normalizePhone(whatsappNumber);
  const actor = String(options.actor ?? 'bot:roleplay_message').trim() || 'bot:roleplay_message';
  const groupJid = String(options.groupJid ?? '').trim() || null;
  const nowIso = new Date().toISOString();

  if (!phone) {
    return {
      phone: '',
      updatedPlayers: [],
      updatedCount: 0,
      unlockedPlayers: [],
    };
  }

  const { error: phoneError } = await supabase
    .from('roleplay_phone_activity')
    .upsert(
      {
        phone,
        last_roleplay_at: nowIso,
        last_roleplay_group_jid: groupJid,
      },
      { onConflict: 'phone' }
    );

  if (phoneError) {
    if (isMissingRoleplaySchemaError(phoneError)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[markRoleplayActivityForPhone.phone]', phoneError.message);
    throw new Error('No se pudo guardar la actividad de roleplay por telefono.');
  }

  const players = await getPlayersByPhone(phone);
  if (!players.length) {
    return {
      phone,
      updatedPlayers: [],
      updatedCount: 0,
      unlockedPlayers: [],
    };
  }

  await seedRoleplayAccessForPlayers(players);
  const accessMap = await getRoleplayAccessMap(players.map((player) => player.id));
  await syncRoleplayExemptionsForPlayers(players, accessMap, actor);

  const updates = [];
  const logs = [];
  const unlockedPlayers = [];

  for (const player of players) {
    const access = accessMap.get(player.id);
    const { isExempt, exemptReason } = computeRoleplayExemption(player);

    updates.push({
      player_id: player.id,
      last_roleplay_at: nowIso,
      grace_until: null,
      locked_at: null,
      lock_reason: null,
      last_roleplay_group_jid: groupJid,
      last_human_roleplay_phone: phone,
      is_exempt: isExempt,
      exempt_reason: exemptReason,
    });

    if (access?.locked_at) {
      unlockedPlayers.push({
        playerId: player.id,
        username: player.username,
        phone: player.phone ?? phone,
      });
      logs.push({
        player_id: player.id,
        phone: player.phone ?? phone,
        action: 'auto_unlocked',
        performed_by: actor,
        details: {
          reason: 'roleplay_detected',
          group_jid: groupJid,
        },
      });
    }
  }

  const { error: accessError } = await supabase
    .from('player_roleplay_access')
    .upsert(updates, { onConflict: 'player_id' });

  if (accessError) {
    if (isMissingRoleplaySchemaError(accessError)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[markRoleplayActivityForPhone.access]', accessError.message);
    throw new Error('No se pudo actualizar el acceso de roleplay del jugador.');
  }

  if (logs.length) {
    await insertRoleplayAccessLog(logs);
  }

  return {
    phone,
    updatedPlayers: players,
    updatedCount: players.length,
    unlockedPlayers,
  };
}

function shouldRoleplayPlayerBeLocked(access, now = new Date()) {
  if (!access || access.is_exempt) {
    return false;
  }

  const nowMs = now.getTime();
  const graceUntilMs = access.grace_until ? new Date(access.grace_until).getTime() : NaN;
  if (Number.isFinite(graceUntilMs) && nowMs <= graceUntilMs) {
    return false;
  }

  const lastRoleplayMs = access.last_roleplay_at ? new Date(access.last_roleplay_at).getTime() : NaN;
  if (!Number.isFinite(lastRoleplayMs)) {
    return true;
  }

  return nowMs - lastRoleplayMs >= ROLEPLAY_LOCK_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

export async function processRoleplayAccessEnforcement() {
  await ensureRoleplayAccessSeeded();

  const { data, error } = await supabase
    .from('player_roleplay_access')
    .select(`${ROLEPLAY_SELECT_COLUMNS}, players!inner(id, username, phone, is_admin)`);

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[processRoleplayAccessEnforcement]', error.message);
    throw new Error('No se pudo evaluar el acceso de roleplay.');
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const updates = [];
  const logs = [];
  const newlyLocked = [];

  for (const row of data ?? []) {
    const player = row.players;
    const { isExempt, exemptReason } = computeRoleplayExemption(player);
    const shouldLock = !isExempt && shouldRoleplayPlayerBeLocked({
      ...row,
      is_exempt: isExempt,
    }, now);

    if (Boolean(row.is_exempt) !== isExempt || String(row.exempt_reason ?? '') !== String(exemptReason ?? '')) {
      updates.push({
        player_id: row.player_id,
        is_exempt: isExempt,
        exempt_reason: exemptReason,
        locked_at: isExempt ? null : row.locked_at ?? null,
        lock_reason: isExempt ? null : row.lock_reason ?? null,
      });
    }

    if (shouldLock && !row.locked_at) {
      updates.push({
        player_id: row.player_id,
        locked_at: nowIso,
        lock_reason: 'roleplay_inactive',
      });
      logs.push({
        player_id: row.player_id,
        phone: player.phone ?? null,
        action: 'auto_locked',
        performed_by: 'bot:scheduler',
        details: {
          inactivity_days: ROLEPLAY_LOCK_AFTER_DAYS,
          last_roleplay_at: row.last_roleplay_at,
          grace_until: row.grace_until,
        },
      });
      newlyLocked.push({
        playerId: row.player_id,
        username: player.username,
        phone: player.phone ?? null,
      });
    }
  }

  if (updates.length) {
    const deduped = Array.from(
      updates.reduce((map, entry) => {
        const current = map.get(entry.player_id) ?? { player_id: entry.player_id };
        map.set(entry.player_id, { ...current, ...entry });
        return map;
      }, new Map()).values()
    );

    const { error: updateError } = await supabase
      .from('player_roleplay_access')
      .upsert(deduped, { onConflict: 'player_id' });

    if (updateError) {
      if (isMissingRoleplaySchemaError(updateError)) {
        throw buildRoleplaySchemaError();
      }
      console.error('[processRoleplayAccessEnforcement.update]', updateError.message);
      throw new Error('No se pudo actualizar el estado de roleplay.');
    }
  }

  if (logs.length) {
    await insertRoleplayAccessLog(logs);
  }

  return {
    newlyLocked,
  };
}

export async function manuallyLockRoleplayAccess(playerId, options = {}) {
  const normalizedPlayerId = String(playerId ?? '').trim();
  const actor = String(options.actor ?? 'admin:manual_lock').trim() || 'admin:manual_lock';
  const phone = normalizePhone(options.phone ?? '');
  const reason = String(options.reason ?? 'manual_lock').trim() || 'manual_lock';

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from('player_roleplay_access')
    .upsert({
      player_id: normalizedPlayerId,
      locked_at: nowIso,
      lock_reason: reason,
      grace_until: null,
      last_human_roleplay_phone: phone || null,
    }, { onConflict: 'player_id' });

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[manuallyLockRoleplayAccess]', error.message);
    throw new Error('No se pudo bloquear manualmente el acceso por roleplay.');
  }

  await insertRoleplayAccessLog([{
    player_id: normalizedPlayerId,
    phone: phone || null,
    action: 'manual_locked',
    performed_by: actor,
    details: {
      reason,
    },
  }]);
}

export async function manuallyUnlockRoleplayAccess(playerId, options = {}) {
  const normalizedPlayerId = String(playerId ?? '').trim();
  const actor = String(options.actor ?? 'admin:manual_unlock').trim() || 'admin:manual_unlock';
  const phone = normalizePhone(options.phone ?? '');
  const graceDays = Math.max(
    1,
    Number.parseInt(String(options.graceDays ?? ROLEPLAY_LOCK_AFTER_DAYS), 10) || ROLEPLAY_LOCK_AFTER_DAYS
  );
  const graceUntil = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('player_roleplay_access')
    .upsert({
      player_id: normalizedPlayerId,
      locked_at: null,
      lock_reason: null,
      grace_until: graceUntil,
      last_human_roleplay_phone: phone || null,
    }, { onConflict: 'player_id' });

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[manuallyUnlockRoleplayAccess]', error.message);
    throw new Error('No se pudo desbloquear manualmente el acceso por roleplay.');
  }

  await insertRoleplayAccessLog([{
    player_id: normalizedPlayerId,
    phone: phone || null,
    action: 'manual_unlocked',
    performed_by: actor,
    details: {
      grace_days: graceDays,
      grace_until: graceUntil,
    },
  }]);
}

export async function extendRoleplayGraceForPlayer(playerId, days, options = {}) {
  const normalizedPlayerId = String(playerId ?? '').trim();
  const actor = String(options.actor ?? 'admin:manual_grace').trim() || 'admin:manual_grace';
  const phone = normalizePhone(options.phone ?? '');
  const safeDays = Math.max(1, Number.parseInt(String(days ?? ROLEPLAY_LOCK_AFTER_DAYS), 10) || ROLEPLAY_LOCK_AFTER_DAYS);
  const graceUntil = new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('player_roleplay_access')
    .upsert({
      player_id: normalizedPlayerId,
      grace_until: graceUntil,
      locked_at: null,
      lock_reason: null,
      last_human_roleplay_phone: phone || null,
    }, { onConflict: 'player_id' });

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[extendRoleplayGraceForPlayer]', error.message);
    throw new Error('No se pudo extender la gracia de roleplay.');
  }

  await insertRoleplayAccessLog([{
    player_id: normalizedPlayerId,
    phone: phone || null,
    action: 'manual_grace_extended',
    performed_by: actor,
    details: {
      grace_days: safeDays,
      grace_until: graceUntil,
    },
  }]);

  return graceUntil;
}

export async function forceRoleplayActivityForPlayer(playerId, options = {}) {
  const normalizedPlayerId = String(playerId ?? '').trim();
  const actor = String(options.actor ?? 'admin:manual_activity').trim() || 'admin:manual_activity';
  const phone = normalizePhone(options.phone ?? '');
  const groupJid = String(options.groupJid ?? '').trim() || null;
  const nowIso = new Date().toISOString();

  const { error } = await supabase
    .from('player_roleplay_access')
    .upsert({
      player_id: normalizedPlayerId,
      last_roleplay_at: nowIso,
      grace_until: null,
      locked_at: null,
      lock_reason: null,
      last_roleplay_group_jid: groupJid,
      last_human_roleplay_phone: phone || null,
    }, { onConflict: 'player_id' });

  if (error) {
    if (isMissingRoleplaySchemaError(error)) {
      throw buildRoleplaySchemaError();
    }
    console.error('[forceRoleplayActivityForPlayer]', error.message);
    throw new Error('No se pudo forzar actividad de roleplay.');
  }

  await insertRoleplayAccessLog([{
    player_id: normalizedPlayerId,
    phone: phone || null,
    action: 'manual_forced_activity',
    performed_by: actor,
    details: {
      group_jid: groupJid,
      last_roleplay_at: nowIso,
    },
  }]);

  return nowIso;
}

function computeArchiveDueAt(referenceDate = new Date()) {
  return new Date(referenceDate.getTime() + PLAYER_LIFECYCLE_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

async function getPlayersByPhoneWithLifecycle(whatsappNumber) {
  const phone = normalizePhone(whatsappNumber);
  if (!phone) return [];

  const { data, error } = await supabase
    .from('players')
    .select(PLAYER_LIFECYCLE_SELECT_COLUMNS)
    .ilike('phone', `%${phone}%`)
    .order('created_at', { ascending: true });

  if (error) {
    if (isMissingLifecycleSchemaError(error)) {
      throw buildPlayerLifecycleSchemaError();
    }
    console.error('[getPlayersByPhoneWithLifecycle]', error.message);
    throw new Error('No se pudo leer el estado lifecycle de los jugadores.');
  }

  return (data ?? []).filter((player) => {
    if (!player.phone) return false;
    const phones = String(player.phone)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    return phones.includes(phone);
  });
}

async function insertPlayerLifecycleLog(entries) {
  if (!entries.length) return;

  const { error } = await supabase
    .from('player_lifecycle_log')
    .insert(entries);

  if (error) {
    if (isMissingLifecycleSchemaError(error)) {
      throw buildPlayerLifecycleSchemaError();
    }
    console.error('[insertPlayerLifecycleLog]', error.message);
    throw new Error('No se pudo registrar la auditoria de lifecycle.');
  }
}

export function getPlayerLifecycleGraceDays() {
  return PLAYER_LIFECYCLE_GRACE_DAYS;
}

export async function markPhoneProfilesLeftGrace(whatsappNumber, options = {}) {
  const phone = normalizePhone(whatsappNumber);
  const groupJid = String(options.groupJid ?? '').trim() || null;
  const actor = String(options.actor ?? 'bot:group_leave').trim() || 'bot:group_leave';

  if (!phone) {
    return {
      phone: '',
      players: [],
      updatedCount: 0,
      archiveDueAt: null,
      graceDays: PLAYER_LIFECYCLE_GRACE_DAYS,
    };
  }

  const players = await getPlayersByPhoneWithLifecycle(phone);
  if (!players.length) {
    return {
      phone,
      players: [],
      matchedPlayers: [],
      updatedCount: 0,
      archiveDueAt: null,
      graceDays: PLAYER_LIFECYCLE_GRACE_DAYS,
    };
  }

  const eligiblePlayers = players.filter((player) => {
    const status = String(player.lifecycle_status ?? 'active').trim().toLowerCase();
    return !status || status === 'active';
  });

  if (!eligiblePlayers.length) {
    return {
      phone,
      players: [],
      matchedPlayers: players,
      updatedCount: 0,
      archiveDueAt: null,
      graceDays: PLAYER_LIFECYCLE_GRACE_DAYS,
    };
  }

  const now = new Date();
  const leftAt = now.toISOString();
  const archiveDueAt = computeArchiveDueAt(now).toISOString();
  const ids = eligiblePlayers.map((player) => player.id);

  const { error } = await supabase
    .from('players')
    .update({
      lifecycle_status: 'left_grace',
      left_group_at: leftAt,
      archive_due_at: archiveDueAt,
      last_known_group_jid: groupJid,
      last_exit_reason: 'group_leave',
    })
    .in('id', ids);

  if (error) {
    if (isMissingLifecycleSchemaError(error)) {
      throw buildPlayerLifecycleSchemaError();
    }
    console.error('[markPhoneProfilesLeftGrace]', error.message);
    throw new Error('No se pudo marcar la gracia del jugador saliente.');
  }

  await insertPlayerLifecycleLog(eligiblePlayers.map((player) => ({
    player_id: player.id,
    phone,
    group_jid: groupJid,
    action: 'group_left',
    from_status: player.lifecycle_status ?? 'active',
    to_status: 'left_grace',
    performed_by: actor,
    details: {
      grace_days: PLAYER_LIFECYCLE_GRACE_DAYS,
      archive_due_at: archiveDueAt,
    },
  })));

  return {
    phone,
    players: eligiblePlayers,
    matchedPlayers: players,
    updatedCount: ids.length,
    archiveDueAt,
    graceDays: PLAYER_LIFECYCLE_GRACE_DAYS,
  };
}

export async function reactivatePhoneProfilesFromGrace(whatsappNumber, options = {}) {
  const phone = normalizePhone(whatsappNumber);
  const groupJid = String(options.groupJid ?? '').trim() || null;
  const actor = String(options.actor ?? 'bot:group_join').trim() || 'bot:group_join';

  if (!phone) {
    return {
      phone: '',
      players: [],
      updatedCount: 0,
    };
  }

  const players = await getPlayersByPhoneWithLifecycle(phone);
  const playersInGrace = players.filter((player) => player.lifecycle_status === 'left_grace');

  if (!playersInGrace.length) {
    return {
      phone,
      players: [],
      updatedCount: 0,
    };
  }

  const reactivatedAt = new Date().toISOString();
  const ids = playersInGrace.map((player) => player.id);

  const { error } = await supabase
    .from('players')
    .update({
      lifecycle_status: 'active',
      left_group_at: null,
      archive_due_at: null,
      reactivated_at: reactivatedAt,
      last_exit_reason: null,
    })
    .in('id', ids);

  if (error) {
    if (isMissingLifecycleSchemaError(error)) {
      throw buildPlayerLifecycleSchemaError();
    }
    console.error('[reactivatePhoneProfilesFromGrace]', error.message);
    throw new Error('No se pudo reactivar el perfil al volver al grupo.');
  }

  await insertPlayerLifecycleLog(playersInGrace.map((player) => ({
    player_id: player.id,
    phone,
    group_jid: groupJid,
    action: 'group_rejoined',
    from_status: player.lifecycle_status ?? 'left_grace',
    to_status: 'active',
    performed_by: actor,
    details: {},
  })));

  return {
    phone,
    players: playersInGrace,
    updatedCount: ids.length,
  };
}

export async function archiveExpiredGraceProfiles(options = {}) {
  const actor = String(options.actor ?? 'bot:scheduler').trim() || 'bot:scheduler';
  const nowIso = new Date().toISOString();

  const { data: players, error: selectError } = await supabase
    .from('players')
    .select(PLAYER_LIFECYCLE_SELECT_COLUMNS)
    .eq('lifecycle_status', 'left_grace')
    .not('archive_due_at', 'is', null)
    .lte('archive_due_at', nowIso)
    .order('archive_due_at', { ascending: true })
    .limit(50);

  if (selectError) {
    if (isMissingLifecycleSchemaError(selectError)) {
      throw buildPlayerLifecycleSchemaError();
    }
    console.error('[archiveExpiredGraceProfiles.select]', selectError.message);
    throw new Error('No se pudo leer los perfiles pendientes de archivo.');
  }

  if (!players?.length) {
    return [];
  }

  const archivedAt = new Date().toISOString();
  const ids = players.map((player) => player.id);
  const { error: updateError } = await supabase
    .from('players')
    .update({
      lifecycle_status: 'archived',
      archived_at: archivedAt,
      archive_due_at: null,
      last_exit_reason: 'grace_expired',
    })
    .in('id', ids);

  if (updateError) {
    if (isMissingLifecycleSchemaError(updateError)) {
      throw buildPlayerLifecycleSchemaError();
    }
    console.error('[archiveExpiredGraceProfiles.update]', updateError.message);
    throw new Error('No se pudo archivar los perfiles con gracia vencida.');
  }

  await insertPlayerLifecycleLog(players.map((player) => ({
    player_id: player.id,
    phone: player.phone || null,
    group_jid: null,
    action: 'auto_archived',
    from_status: player.lifecycle_status ?? 'left_grace',
    to_status: 'archived',
    performed_by: actor,
    details: {
      archive_due_at: player.archive_due_at,
    },
  })));

  return players;
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

export async function placeBet(playerId, amount, gameType) {
  const { data, error } = await supabase.rpc('place_bet', {
    p_player_id: playerId,
    p_amount: Math.trunc(amount),
    p_game_type: gameType,
  });

  if (error) {
    console.error('[placeBet]', error.message);
    throw new Error(error.message || 'No se pudo procesar la apuesta.');
  }

  return data; // Returns the bet_id UUID
}

export async function resolveBet(betId, payout) {
  const { data, error } = await supabase.rpc('resolve_bet', {
    p_bet_id: betId,
    p_payout: Math.trunc(payout),
  });

  if (error) {
    console.error('[resolveBet]', error.message);
    throw new Error(error.message || 'No se pudo resolver la apuesta.');
  }

  return data;
}

export async function getUnresolvedBets(minutesOld = 10) {
  const cutoffTime = new Date(Date.now() - minutesOld * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('bot_active_bets')
    .select('id, player_id, amount, game_type, created_at, players(phone)')
    .eq('resolved', false)
    .lt('created_at', cutoffTime);

  if (error) {
    console.error('[getUnresolvedBets]', error.message);
    return [];
  }
  return data;
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

const RECYCLED_SHEET_SELECT_COLUMNS = [
  'id',
  'playerId',
  'name',
  'race',
  'profession',
  'birthRealm',
  'recycleStatus',
  'originalPlayerId',
  'originalPlayerUsername',
  'recycledAt',
].join(', ');

export async function getRecycledCharacterSheets(limit = 20) {
  const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 50);
  const { data, error } = await supabase
    .from('character_sheets')
    .select(RECYCLED_SHEET_SELECT_COLUMNS)
    .eq('recycleStatus', 'available')
    .order('recycledAt', { ascending: false, nullsFirst: false })
    .limit(safeLimit);

  if (error) {
    console.error('[getRecycledCharacterSheets]', error.message);
    throw new Error('No pude leer las fichas recicladas. Verifica que el SQL de reciclaje este aplicado.');
  }

  return data ?? [];
}

export async function findRecycledCharacterSheet(identifier) {
  const rawIdentifier = String(identifier ?? '').trim();
  if (!rawIdentifier) {
    return { sheet: null, reason: 'missing', matches: [] };
  }

  const normalizedIdentifier = normalizeText(rawIdentifier);
  const sheets = await getRecycledCharacterSheets(50);
  if (!sheets.length) {
    return { sheet: null, reason: 'empty', matches: [] };
  }

  const idMatches = sheets.filter((sheet) =>
    String(sheet.id ?? '').toLowerCase().startsWith(rawIdentifier.toLowerCase())
  );
  if (idMatches.length === 1) {
    return { sheet: idMatches[0], reason: 'ok', matches: idMatches, matchType: 'id-prefix' };
  }
  if (idMatches.length > 1) {
    return { sheet: null, reason: 'ambiguous', matches: idMatches, matchType: 'id-prefix' };
  }

  const exactMatches = sheets.filter((sheet) => normalizeText(sheet.name) === normalizedIdentifier);
  if (exactMatches.length === 1) {
    return { sheet: exactMatches[0], reason: 'ok', matches: exactMatches, matchType: 'name-exact' };
  }
  if (exactMatches.length > 1) {
    return { sheet: null, reason: 'ambiguous', matches: exactMatches, matchType: 'name-exact' };
  }

  const prefixMatches = sheets.filter((sheet) => normalizeText(sheet.name).startsWith(normalizedIdentifier));
  if (prefixMatches.length === 1) {
    return { sheet: prefixMatches[0], reason: 'ok', matches: prefixMatches, matchType: 'name-prefix' };
  }
  if (prefixMatches.length > 1) {
    return { sheet: null, reason: 'ambiguous', matches: prefixMatches, matchType: 'name-prefix' };
  }

  const containsMatches = sheets.filter((sheet) => normalizeText(sheet.name).includes(normalizedIdentifier));
  if (containsMatches.length === 1) {
    return { sheet: containsMatches[0], reason: 'ok', matches: containsMatches, matchType: 'name-contains' };
  }
  if (containsMatches.length > 1) {
    return { sheet: null, reason: 'ambiguous', matches: containsMatches, matchType: 'name-contains' };
  }

  return { sheet: null, reason: 'not_found', matches: [] };
}

export async function assignRecycledCharacterSheetToPlayer({ sheetId, targetPlayerId, actorName = 'bot' }) {
  const { data, error } = await supabase.rpc('assign_recycled_character_sheet', {
    p_sheet_id: sheetId,
    p_target_player_id: targetPlayerId,
    p_actor: actorName,
  });

  if (error) {
    console.error('[assignRecycledCharacterSheetToPlayer]', error.message);
    throw new Error(error.message || 'No se pudo asignar la ficha reciclada.');
  }

  return Array.isArray(data) ? data[0] : data;
}

let knowledgeCache = null;
let knowledgeCacheExpiresAt = 0;
const KNOWLEDGE_CACHE_TTL_MS = 1000 * 60 * 15; // 15 minutos

export async function getKnowledgeDocuments() {
  const now = Date.now();
  if (knowledgeCache && now < knowledgeCacheExpiresAt) {
    return knowledgeCache;
  }

  const selectColumns =
    KNOWLEDGE_CONTENT_MODE === 'full'
      ? 'id, title, type, category, tags, source, content, summary, visible'
      : 'id, title, type, category, tags, source, summary, visible';

  const { data, error } = await supabase
    .from('knowledge_documents')
    .select(selectColumns)
    .eq('visible', true);

  if (error) {
    console.error('[getKnowledgeDocuments]', error.message);
    return [];
  }
  
  knowledgeCache = (data || []).map((document) => ({
    ...document,
    content: document.content || '',
  }));
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
  const normalizedQuestion = question
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  const tokens = normalizedQuestion
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/g)
    .filter((token) => token.length > 2);

  const exactPhrases = normalizedQuestion
    .split(/[?!.,;:]+/g)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);

  const uniqueTokens = [...new Set(tokens)];
  const uniquePhrases = [...new Set(exactPhrases)];

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
      
    const phraseScore = uniquePhrases.reduce((total, phrase) => {
      const titleHit = title.includes(phrase) ? 20 : 0;
      const metadataHit = metadata.includes(phrase) ? 10 : 0;
      const contentHit = content.includes(phrase) ? 4 : 0;
      return total + titleHit + metadataHit + contentHit;
    }, 0);

    const tokenScore = uniqueTokens.reduce((total, token) => {
      const titleHit = title.includes(token) ? 6 : 0;
      const metadataHit = metadata.includes(token) ? 3 : 0;
      const contentHit = content.includes(token) ? 1 : 0;
      return total + titleHit + metadataHit + contentHit;
    }, 0);

    const categoryBonus = (
      (document.category === 'lore' || document.category === 'world' ? 2 : 0) +
      (document.type === 'grimoire' || document.type === 'mission' || document.type === 'event' ? 1 : 0)
    );

    return { document, score: phraseScore + tokenScore + categoryBonus };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .filter((entry) => entry.score > 0)
    .slice(0, maxDocuments)
    .map((entry) => entry.document);
}

export async function getPlayerSheet(playerId) {
  if (!playerId) return null;
  const { data, error } = await supabase
    .from('character_sheets')
    .select('name, race, powers, weapon, birthRealm, personality, profession, history, combatStyle')
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
  const normalizedPrefix = prefix.toLowerCase();

  if (missionPrefixFilterSupported) {
    const { data: filteredData, error: filteredError } = await supabase
      .from('realm_missions')
      .select('id, title, instructions')
      .ilike('id', `${normalizedPrefix}%`)
      .limit(2);

    if (!filteredError && filteredData) {
      return filteredData.length === 1 ? filteredData[0] : null;
    }

    if (filteredError) {
      missionPrefixFilterSupported = false;
      console.warn('[getMissionByShortId] prefix filter fallback:', filteredError.message);
    }
  }

  const { data, error } = await supabase
    .from('realm_missions')
    .select('id, title, instructions');

  if (error) {
    console.error('[getMissionByShortId]', error.message);
    return null;
  }

  if (!data) return null;

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
    instance_id: state.instanceId,
    short_id: state.shortId,
    mission_id: state.id,
    title: state.title,
    instructions: state.instructions,
    gm_config: state.gmConfig,
    max_participants: state.maxParticipants,
    player_message_count: state.playerMessageCount,
    gm_round_count: state.gmRoundCount,
    context: state.context,
    participants: state.participants || [],
    participants_counted: Array.from(state.participantsCounted || []),
    resolved: state.resolved,
    final_state: state.finalState
  };

  const { error } = await botStateSupabase
    .from('bot_active_missions')
    .upsert(payload, { onConflict: 'instance_id' });

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

export async function deleteResolvedMission(instanceId) {
  const { error } = await botStateSupabase
    .from('bot_active_missions')
    .delete()
    .eq('instance_id', instanceId);

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

