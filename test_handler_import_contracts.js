process.env.SUPABASE_URL ||= 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

await import('./src/handlers/admin.js');
await import('./src/handlers/player.js');

console.log('HANDLER_IMPORT_CONTRACTS_OK');
process.exit(0);
