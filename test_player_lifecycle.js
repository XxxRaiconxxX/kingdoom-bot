import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.BOT_SUPABASE_URL ||= process.env.SUPABASE_URL;
process.env.BOT_SUPABASE_SERVICE_KEY ||= process.env.SUPABASE_SERVICE_KEY;
process.env.PLAYER_LIFECYCLE_ADMIN_IDS = '595981111111@c.us,240797811245267@lid';

const { buildPlayerLifecycleConfig } = await import('./src/handlers/playerLifecycle.js');
const config = buildPlayerLifecycleConfig();

assert.deepEqual(config.adminIds, [
  '595981111111@c.us',
  '240797811245267@lid',
]);

console.log('PLAYER_LIFECYCLE_CONFIG_OK');
