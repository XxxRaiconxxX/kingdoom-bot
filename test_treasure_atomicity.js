import assert from 'node:assert/strict';
import fs from 'node:fs';

const botStateSql = fs.readFileSync(
  new URL('./supabase/supabase_bot_state_migration.sql', import.meta.url),
  'utf8'
);
const primarySql = fs.readFileSync(
  new URL('./supabase/supabase_treasure_gold_awards.sql', import.meta.url),
  'utf8'
);
const supabaseSource = fs.readFileSync(new URL('./src/supabase.js', import.meta.url), 'utf8');

assert.match(botStateSql, /create or replace function public\.reserve_treasure_claim/i);
assert.match(botStateSql, /for update;/i, 'La reserva debe serializar reclamos por evento.');
assert.match(botStateSql, /unique \(event_message_id, player_id\)/i);
assert.match(botStateSql, /credit_status in \('pending', 'credited'\)/i);
assert.match(
  botStateSql,
  /revoke all on function public\.reserve_treasure_claim[\s\S]+from anon, authenticated/i
);

assert.match(primarySql, /create or replace function public\.award_bot_gold_once/i);
assert.match(primarySql, /pg_advisory_xact_lock/i, 'El abono idempotente debe serializar su clave.');
assert.match(primarySql, /unique \(source, external_ref\)/i);
assert.match(primarySql, /weekly_gold = coalesce\(weekly_gold, 0\) \+ p_reward_gold/i);
assert.match(primarySql, /alter table public\.bot_gold_awards enable row level security/i);
assert.match(primarySql, /revoke all on table public\.bot_gold_awards from anon, authenticated/i);
assert.match(
  primarySql,
  /revoke all on function public\.award_bot_gold_once[\s\S]+from anon, authenticated/i
);

assert.match(supabaseSource, /\.rpc\(\s*'reserve_treasure_claim'/s);
assert.match(supabaseSource, /\.rpc\('award_bot_gold_once'/s);
assert.match(supabaseSource, /p_external_ref: reservation\.claim_id/);
assert.match(supabaseSource, /claimTreasureRewardLegacy/, 'El despliegue debe conservar compatibilidad hasta aplicar SQL.');
assert.match(supabaseSource, /export async function reconcilePendingTreasureCredits/);

const schedulerSource = fs.readFileSync(new URL('./src/scheduler.js', import.meta.url), 'utf8');
assert.match(schedulerSource, /treasureCreditReconciliationRunning/);

console.log('TREASURE_ATOMICITY_OK');
