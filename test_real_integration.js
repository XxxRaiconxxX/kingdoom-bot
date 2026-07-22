import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

if (process.env.RUN_REAL_AUDIT !== '1') {
  throw new Error('Define RUN_REAL_AUDIT=1 para ejecutar pruebas que crean datos sinteticos temporales.');
}

const {
  botStateSupabase,
  claimTreasureReward,
  createTreasureEvent,
  getCofreUsage,
  getDadosUsage,
  getTrampaUsage,
  incrementDadosUsage,
  placeBet,
  resolveBet,
  supabase,
  transferGold,
  updateGold,
  usingDedicatedBotStateSupabase,
} = await import('./src/supabase.js');
const { handleCofre, handleDados, handleTrampa } = await import('./src/handlers/games.js');
const {
  activeSessions,
  handleBlackjack,
  handleBlackjackReply,
} = await import('./src/handlers/blackjack.js');
const { handleAdminCommand } = await import('./src/handlers/admin.js');
const { cancelActiveMission, getActiveMissionsList } = await import('./src/gmTracker.js');

assert.equal(usingDedicatedBotStateSupabase, true, 'La auditoria real debe usar el Supabase dedicado del bot.');

const runId = randomUUID().replace(/-/g, '').slice(0, 12);
const playerIds = [];
const eventMessageIds = [];
const auctionArtifacts = [];
const missionInstanceIds = [];
const authUserIds = [];

function throwIfError(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

async function readGold(playerId) {
  const { data, error } = await supabase
    .from('players')
    .select('gold')
    .eq('id', playerId)
    .single();
  throwIfError(error, 'readGold');
  return Number(data.gold);
}

async function createSyntheticPlayers(labels) {
  const rows = labels.map((label, index) => ({
    username: `__codex_audit_${runId}_${label}`,
    phone: `5988${runId.replace(/\D/g, '').padEnd(12, '7').slice(0, 8)}${String(index).padStart(2, '0')}`,
    gold: 1_000_000,
    weekly_gold: 0,
    banned: false,
  }));
  const { data, error } = await supabase.from('players').insert(rows).select('id, username, phone, gold');
  throwIfError(error, 'createSyntheticPlayers');
  playerIds.push(...data.map(({ id }) => id));
  return Object.fromEntries(data.map((row, index) => [labels[index], row]));
}

async function assertPermissionDenied(client, rpc, args, actor = 'anon') {
  const { error, status } = await client.rpc(rpc, args);
  assert.ok(error, `${rpc} fue ejecutable con ${actor} (HTTP ${status}).`);
  assert.ok(
    status === 401 || String(error.code) === '42501',
    `${rpc} alcanzo logica interna en vez de ser denegada: ${error.code} ${error.message}`
  );
}

async function assertTableDenied(client, table) {
  const { error, status } = await client.from(table).select('*', { count: 'exact', head: true });
  assert.ok(error, `${table} fue legible con anon (HTTP ${status}).`);
  assert.ok(status === 401 || status === 403, `${table} devolvio HTTP ${status} en vez de denegar acceso.`);
}

function makeGameMessage(player, body) {
  return {
    author: null,
    body,
    from: `${player.phone}@c.us`,
    hasQuotedMsg: false,
    id: { _serialized: `audit-${runId}-${player.id}-${body.replace(/\W+/g, '-')}` },
    mentionedIds: [],
  };
}

try {
  const players = await createSyntheticPlayers([
    'transfer_a',
    'transfer_b',
    'usage',
    'dados',
    'trampa',
    'cofre',
    'blackjack',
    'treasure_a',
    'treasure_b',
    'auction_a',
    'auction_b',
  ]);

  const primaryProbe = await supabase.from('players').select('id', { count: 'exact', head: true });
  throwIfError(primaryProbe.error, 'primary connection');
  const botProbe = await botStateSupabase.from('bot_daily_claims').select('id', { count: 'exact', head: true });
  throwIfError(botProbe.error, 'bot-state connection');

  const { data: missionRows, error: missionRowsError } = await supabase
    .from('realm_missions')
    .select('id, title')
    .limit(100);
  throwIfError(missionRowsError, 'mission lookup');
  assert.ok(missionRows.length > 0, 'Se necesita una mision existente para probar !misionstart.');
  const mission = missionRows.find((candidate) => {
    const prefix = String(candidate.id).slice(0, 6).toLowerCase();
    return missionRows.filter((row) => String(row.id).toLowerCase().startsWith(prefix)).length === 1;
  }) ?? missionRows[0];
  const missionCode = String(mission.id).slice(0, 6);
  const missionMessages = [];
  const missionCommandResult = await handleAdminCommand({
    author: '595987273405@c.us',
    body: `!misionstart ${missionCode}`,
    from: `audit-mission-${runId}@g.us`,
    hasQuotedMsg: false,
    mentionedIds: [`${players.usage.phone}@c.us`],
  }, {
    async sendMessage(chatId, text, options) {
      missionMessages.push({ chatId, text, options });
      return { id: { _serialized: `audit-mission-message-${runId}` } };
    },
  });
  assert.equal(missionCommandResult, '');
  assert.equal(missionMessages.length, 1);
  assert.doesNotMatch(missionMessages[0].text, /\*\*|^#{1,6}\s|^\s*\|/m);
  const activeMission = getActiveMissionsList().find((state) => state.shortId === missionCode.toUpperCase());
  assert.ok(activeMission, '!misionstart no creo una mision activa en memoria.');
  missionInstanceIds.push(activeMission.instanceId);
  const { count: persistedMissionCount, error: persistedMissionError } = await botStateSupabase
    .from('bot_active_missions')
    .select('*', { count: 'exact', head: true })
    .eq('instance_id', activeMission.instanceId);
  throwIfError(persistedMissionError, 'mission persistence');
  assert.equal(persistedMissionCount, 1);
  assert.equal(await cancelActiveMission(activeMission.instanceId), true);
  missionInstanceIds.length = 0;
  const { count: closedMissionCount, error: closedMissionError } = await botStateSupabase
    .from('bot_active_missions')
    .select('*', { count: 'exact', head: true })
    .eq('instance_id', activeMission.instanceId);
  throwIfError(closedMissionError, 'mission close persistence');
  assert.equal(closedMissionCount, 0);

  await transferGold(players.transfer_a.id, players.transfer_b.id, 12_345);
  assert.equal(await readGold(players.transfer_a.id), 987_655);
  assert.equal(await readGold(players.transfer_b.id), 1_012_345);
  assert.equal((await readGold(players.transfer_a.id)) + (await readGold(players.transfer_b.id)), 2_000_000);

  await updateGold(players.transfer_a.id, 345);
  await updateGold(players.transfer_a.id, -345);
  assert.equal(await readGold(players.transfer_a.id), 987_655);

  const betId = await placeBet(players.transfer_a.id, 1_000, 'audit_escrow');
  assert.equal(await readGold(players.transfer_a.id), 986_655);
  assert.equal(await resolveBet(betId, 1_250), true);
  assert.equal(await readGold(players.transfer_a.id), 987_905);
  await assert.rejects(resolveBet(betId, 1_250));
  assert.equal(await readGold(players.transfer_a.id), 987_905, 'Una segunda resolucion no debe duplicar pago.');

  const usageResults = await Promise.allSettled(
    Array.from({ length: 8 }, () => incrementDadosUsage(players.usage.id, 1, 4))
  );
  assert.equal(usageResults.filter(({ status }) => status === 'fulfilled').length, 4);
  assert.equal(usageResults.filter(({ status }) => status === 'rejected').length, 4);
  assert.equal(await getDadosUsage(players.usage.id), 4);

  const dadosBefore = await readGold(players.dados.id);
  const dadosReply = await handleDados(makeGameMessage(players.dados, '!dados 100'));
  assert.equal(typeof dadosReply, 'string');
  assert.ok([dadosBefore - 100, dadosBefore + 100].includes(await readGold(players.dados.id)));
  assert.equal(await getDadosUsage(players.dados.id), 1);

  const trampaBefore = await readGold(players.trampa.id);
  const trampaReply = await handleTrampa(makeGameMessage(players.trampa, '!trampa 100'));
  assert.equal(typeof trampaReply, 'string');
  assert.ok(
    [-100, 0, 25, 50, 75, 100].includes((await readGold(players.trampa.id)) - trampaBefore),
    'La trampa produjo un delta fuera de su tabla.'
  );
  assert.equal(await getTrampaUsage(players.trampa.id), 1);

  const cofreBefore = await readGold(players.cofre.id);
  const cofreMessage = makeGameMessage(players.cofre, '!cofre');
  const cofreReply = await handleCofre(cofreMessage);
  assert.equal(typeof cofreReply, 'string');
  assert.ok(
    [0, 2_000, 5_000, 10_000, 20_000, 35_000, 50_000].includes(
      (await readGold(players.cofre.id)) - cofreBefore
    ),
    'El cofre produjo un premio fuera de su tabla.'
  );
  assert.equal(await getCofreUsage(players.cofre.id), 1);
  const cofreAfter = await readGold(players.cofre.id);
  assert.equal(typeof await handleCofre(cofreMessage), 'string');
  assert.equal(await readGold(players.cofre.id), cofreAfter, 'Reprocesar el mismo mensaje no debe duplicar oro.');
  assert.equal(await getCofreUsage(players.cofre.id), 1, 'Reprocesar el mismo mensaje no debe duplicar uso.');

  const blackjackReplies = [];
  const blackjackMessage = {
    ...makeGameMessage(players.blackjack, '!21 100'),
    async reply(text) {
      blackjackReplies.push(text);
      return { id: { _serialized: `audit-blackjack-${runId}-${blackjackReplies.length}` } };
    },
  };
  const blackjackBefore = await readGold(players.blackjack.id);
  const blackjackStartReply = await handleBlackjack(blackjackMessage, { sendMessage: async () => null });
  const activeEntry = [...activeSessions.entries()]
    .find(([, session]) => session.playerId === players.blackjack.id);
  if (activeEntry) {
    const [sessionId, session] = activeEntry;
    await handleBlackjackReply({ ...blackjackMessage, body: 'plantarse' }, session, sessionId, {});
  } else {
    assert.equal(typeof blackjackStartReply, 'string', 'Blackjack natural debe devolver resultado visible.');
  }
  assert.equal([...activeSessions.values()].some(({ playerId }) => playerId === players.blackjack.id), false);
  assert.ok(
    [-100, 0, 100, 150].includes((await readGold(players.blackjack.id)) - blackjackBefore),
    'Blackjack produjo un pago fuera de sus reglas.'
  );
  const { count: unresolvedBlackjack, error: unresolvedError } = await supabase
    .from('bot_active_bets')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', players.blackjack.id)
    .eq('resolved', false);
  throwIfError(unresolvedError, 'blackjack unresolved check');
  assert.equal(unresolvedBlackjack, 0);

  const treasureMessageId = `audit-treasure-${runId}`;
  const treasureChatId = `audit-chat-${runId}@g.us`;
  eventMessageIds.push(treasureMessageId);
  await createTreasureEvent({
    chatId: treasureChatId,
    messageId: treasureMessageId,
    maxWinners: 1,
    expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  });
  const treasureBefore = (await readGold(players.treasure_a.id)) + (await readGold(players.treasure_b.id));
  const claims = await Promise.all([
    claimTreasureReward(treasureMessageId, players.treasure_a.id, treasureChatId),
    claimTreasureReward(treasureMessageId, players.treasure_b.id, treasureChatId),
  ]);
  const successfulClaims = claims.filter(({ status }) => status === 'ok');
  assert.equal(successfulClaims.length, 1);
  assert.equal(claims.filter(({ status }) => status === 'full').length, 1);
  const treasureAfter = (await readGold(players.treasure_a.id)) + (await readGold(players.treasure_b.id));
  assert.equal(treasureAfter - treasureBefore, successfulClaims[0].reward_gold);
  const { count: creditedClaims, error: claimsError } = await botStateSupabase
    .from('bot_treasure_claims')
    .select('*', { count: 'exact', head: true })
    .eq('event_message_id', treasureMessageId)
    .eq('credit_status', 'credited');
  throwIfError(claimsError, 'treasure credited check');
  assert.equal(creditedClaims, 1);

  const deliveryColumns = await botStateSupabase
    .from('bot_notifications_queue')
    .select('delivery_message_id, delivery_started_at, delivery_attempts, delivery_error')
    .limit(1);
  throwIfError(deliveryColumns.error, 'notification delivery migration');

  const itemName = `Audit Auction ${runId}`;
  const { data: auction, error: auctionInsertError } = await supabase
    .from('market_auctions')
    .insert({
      item_name: itemName,
      item_description: 'Registro sintetico descartable de auditoria.',
      item_category: 'audit',
      item_rarity: 'common',
      start_price: 10_000,
      min_increment: 1_000,
      status: 'active',
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    })
    .select('id')
    .single();
  throwIfError(auctionInsertError, 'auction insert');
  auctionArtifacts.push({ id: auction.id, itemName });

  throwIfError((await supabase.rpc('place_auction_bid', {
    p_player_id: players.auction_a.id,
    p_auction_id: auction.id,
    p_amount: 10_000,
  })).error, 'auction bid A1');
  assert.equal(await readGold(players.auction_a.id), 987_500, 'Primera puja debe cobrar lock + comision 25%.');

  throwIfError((await supabase.rpc('place_auction_bid', {
    p_player_id: players.auction_b.id,
    p_auction_id: auction.id,
    p_amount: 11_000,
  })).error, 'auction bid B1');
  assert.equal(await readGold(players.auction_a.id), 997_500, 'Al ser superado debe recuperar el lock, no la comision.');
  assert.equal(await readGold(players.auction_b.id), 986_500);

  throwIfError((await supabase.rpc('place_auction_bid', {
    p_player_id: players.auction_a.id,
    p_auction_id: auction.id,
    p_amount: 12_000,
  })).error, 'auction bid A2');
  assert.equal(await readGold(players.auction_a.id), 985_500, 'Reingresar no debe cobrar otra comision.');
  assert.equal(await readGold(players.auction_b.id), 997_500);

  throwIfError((await supabase.from('market_auctions')
    .update({ expires_at: new Date(Date.now() - 1_000).toISOString() })
    .eq('id', auction.id)).error, 'auction expire');
  throwIfError((await supabase.rpc('resolve_market_auction', { p_auction_id: auction.id })).error, 'auction resolve');
  assert.equal(await readGold(players.auction_a.id), 985_500, 'Resolver no debe cobrar dos veces la puja ganadora.');
  const { count: wonItems, error: inventoryError } = await supabase
    .from('player_inventory')
    .select('*', { count: 'exact', head: true })
    .eq('player_id', players.auction_a.id)
    .eq('item_id', auction.id);
  throwIfError(inventoryError, 'auction inventory');
  assert.equal(wonItems, 1);

  const anonKey = String(process.env.SUPABASE_ANON_KEY ?? '').trim();
  assert.ok(anonKey, 'Falta SUPABASE_ANON_KEY para probar permisos anon de forma real.');
  const anon = createClient(process.env.SUPABASE_URL, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const missingId = randomUUID();
  await assertTableDenied(anon, 'bot_gold_awards');
  await assertPermissionDenied(anon, 'increment_gold', { p_player_id: missingId, p_amount: 1 });
  await assertPermissionDenied(anon, 'place_bet', { p_player_id: missingId, p_amount: 1, p_game_type: 'audit' });
  await assertPermissionDenied(anon, 'resolve_bet', { p_bet_id: missingId, p_payout: 0 });
  await assertPermissionDenied(anon, 'transfer_player_gold', {
    p_from_player_id: missingId,
    p_to_player_id: randomUUID(),
    p_amount: 1,
  });
  await assertPermissionDenied(anon, 'withdraw_from_auction', {
    p_player_id: missingId,
    p_auction_id: randomUUID(),
  });
  await assertPermissionDenied(anon, 'resolve_market_auction', { p_auction_id: missingId });
  await assertPermissionDenied(anon, 'award_bot_gold_once', {
    p_player_id: missingId,
    p_reward_gold: 1,
    p_source: 'audit',
    p_external_ref: `audit-${runId}`,
  });
  await assertPermissionDenied(anon, 'award_manual_mission_rank_points', {
    p_player_ids: [],
    p_difficulty: 'easy',
    p_awarded_by_name: 'audit',
    p_awarded_by_phone: null,
    p_notes: 'audit',
    p_external_ref: `audit-${runId}`,
  });
  await assertPermissionDenied(anon, 'assign_recycled_character_sheet', {
    p_sheet_id: missingId,
    p_target_player_id: missingId,
    p_actor: 'audit',
  });
  await assertPermissionDenied(anon, 'process_market_installments', {});

  const botAnonKey = String(process.env.BOT_SUPABASE_ANON_KEY ?? '').trim();
  assert.ok(botAnonKey, 'Falta BOT_SUPABASE_ANON_KEY para probar permisos del Supabase dedicado.');
  const botAnon = createClient(process.env.BOT_SUPABASE_URL, botAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const table of [
    'bot_daily_claims',
    'bot_active_missions',
    'bot_treasure_events',
    'bot_treasure_claims',
    'bot_notifications_queue',
    'bot_command_logs',
    'bot_game_rewards',
  ]) {
    await assertTableDenied(botAnon, table);
  }
  await assertPermissionDenied(botAnon, 'reserve_treasure_claim', {
    p_message_id: `audit-denied-${runId}`,
    p_player_id: missingId,
    p_chat_id: `audit-denied-${runId}@g.us`,
    p_reward_gold: 10_000,
  });
  await assertPermissionDenied(botAnon, 'mark_treasure_claim_credited', { p_claim_id: missingId });
  await assertPermissionDenied(botAnon, 'reserve_cofre_reward', {
    p_message_id: `audit-denied-${runId}`,
    p_player_id: missingId,
    p_claim_date: new Date().toISOString().slice(0, 10),
    p_usage_count: 1,
    p_max_usage: 4,
    p_reward_gold: 0,
    p_result_summary: 'audit',
  });
  await assertPermissionDenied(botAnon, 'mark_game_reward_credited', { p_reservation_id: missingId });

  const { data: anonymousAuth, error: anonymousAuthError } = await anon.auth.signInAnonymously();
  throwIfError(anonymousAuthError, 'anonymous authenticated session');
  assert.ok(anonymousAuth.user?.id && anonymousAuth.session?.access_token);
  authUserIds.push(anonymousAuth.user.id);

  await assertPermissionDenied(anon, 'increment_gold', {
    p_player_id: players.transfer_a.id,
    p_amount: 1,
  }, 'authenticated user without player link');
  await assertPermissionDenied(anon, 'place_auction_bid', {
    p_player_id: players.auction_a.id,
    p_auction_id: missingId,
    p_amount: 10_000,
  }, 'authenticated user without player link');
  await assertPermissionDenied(anon, 'withdraw_from_auction', {
    p_player_id: players.auction_a.id,
    p_auction_id: missingId,
  }, 'authenticated user without player link');
  const transferBefore = await readGold(players.transfer_a.id);
  const { data: unauthorizedTransfer, error: unauthorizedTransferError } = await anon.rpc(
    'transfer_player_gold',
    {
      p_from_player_id: players.transfer_a.id,
      p_to_player_id: players.transfer_b.id,
      p_amount: 1,
    }
  );
  throwIfError(unauthorizedTransferError, 'unlinked authenticated transfer guard');
  assert.equal(unauthorizedTransfer?.[0]?.success, false);
  assert.equal(await readGold(players.transfer_a.id), transferBefore);
  assert.equal(await readGold(players.transfer_a.id), 987_905);

  console.log('REAL_INTEGRATION_OK=' + JSON.stringify({
    primary: true,
    dedicatedBotState: true,
    transfer: true,
    betEscrow: true,
    usageConcurrency: true,
    games: ['dados', 'trampa', 'cofre', 'blackjack'],
    missionStart: true,
    treasureConcurrency: true,
    notificationTracking: true,
    auctionLockRelease: true,
    anonRpcDenied: true,
    botAnonRpcDenied: true,
    botStateTablesDenied: true,
    unlinkedAuthenticatedRpcDenied: true,
  }));
} finally {
  for (const authUserId of authUserIds) {
    const { error } = await supabase.auth.admin.deleteUser(authUserId);
    throwIfError(error, 'temporary auth user cleanup');
  }
  for (const instanceId of missionInstanceIds) {
    await cancelActiveMission(instanceId).catch(() => false);
    await botStateSupabase.from('bot_active_missions').delete().eq('instance_id', instanceId);
  }
  for (const session of activeSessions.values()) {
    if (session?.timeoutRef) clearTimeout(session.timeoutRef);
  }
  activeSessions.clear();

  for (const messageId of eventMessageIds) {
    await botStateSupabase.from('bot_treasure_claims').delete().eq('event_message_id', messageId);
    await botStateSupabase.from('bot_treasure_events').delete().eq('message_id', messageId);
  }
  if (playerIds.length > 0) {
    await botStateSupabase.from('bot_game_rewards').delete().in('player_id', playerIds);
    await botStateSupabase.from('bot_daily_claims').delete().in('player_id', playerIds);
    await supabase.from('bot_active_bets').delete().in('player_id', playerIds);
    await supabase.from('bot_gold_awards').delete().in('player_id', playerIds);
  }
  for (const artifact of auctionArtifacts) {
    await supabase.from('player_inventory').delete().eq('item_id', artifact.id);
    await supabase.from('market_orders').delete().eq('order_ref', `AUC-${artifact.id.slice(0, 8)}`);
    await supabase.from('player_notifications').delete().eq('item_name', artifact.itemName);
    await supabase.from('market_auctions').delete().eq('id', artifact.id);
  }
  if (playerIds.length > 0) {
    await supabase.from('players').delete().in('id', playerIds);
  }
}
