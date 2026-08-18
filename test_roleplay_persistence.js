import assert from 'node:assert/strict';
import http from 'node:http';

const playerId = '00000000-0000-4000-8000-000000000099';
const primaryPhone = '595981111222';
const lidPhone = '240797811245267';
const manualLockedAt = '2026-08-18T12:00:00.000Z';
let phoneActivityRows = [];
let accessUpdateRows = [];
let accessLogRows = [];
let rpcAttempts = 0;

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  return body ? JSON.parse(body) : null;
}

const server = http.createServer(async (request, response) => {
  response.setHeader('Content-Type', 'application/json');
  const url = decodeURIComponent(request.url ?? '');

  if (request.method === 'GET' && url.startsWith('/rest/v1/players')) {
    response.end(JSON.stringify([{
      id: playerId,
      username: 'LidPlayer',
      gold: 100,
      weekly_gold: 0,
      phone: lidPhone,
      is_admin: false,
      banned: false,
      created_at: '2026-01-01T00:00:00.000Z',
      last_active_at: null,
    }]));
    return;
  }

  if (request.method === 'GET' && url.startsWith('/rest/v1/player_roleplay_access')) {
    response.end(JSON.stringify([{
      player_id: playerId,
      last_roleplay_at: '2026-08-01T00:00:00.000Z',
      grace_until: null,
      locked_at: manualLockedAt,
      lock_reason: 'moderation_review',
      last_roleplay_group_jid: null,
      last_human_roleplay_phone: null,
      is_exempt: false,
      exempt_reason: null,
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-18T12:00:00.000Z',
    }]));
    return;
  }

  if (request.method === 'POST' && url.startsWith('/rest/v1/rpc/record_roleplay_activity')) {
    rpcAttempts += 1;
    response.statusCode = 404;
    response.end(JSON.stringify({
      code: 'PGRST202',
      message: 'Could not find the function public.record_roleplay_activity in the schema cache',
    }));
    return;
  }

  if (request.method === 'POST' && url.startsWith('/rest/v1/roleplay_phone_activity')) {
    phoneActivityRows = await readJsonBody(request);
    response.statusCode = 201;
    response.end('[]');
    return;
  }

  if (request.method === 'POST' && url.startsWith('/rest/v1/player_roleplay_access_log')) {
    accessLogRows = await readJsonBody(request);
    response.statusCode = 201;
    response.end('[]');
    return;
  }

  if (request.method === 'POST' && url.startsWith('/rest/v1/player_roleplay_access')) {
    const rows = await readJsonBody(request);
    if (rows?.[0]?.last_roleplay_at) accessUpdateRows = rows;
    response.statusCode = 201;
    response.end('[]');
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ code: 'NOT_FOUND', message: url }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');

process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
process.env.SUPABASE_SERVICE_KEY = 'roleplay-test-service-key';

try {
  const { markRoleplayActivityForPhone } = await import(
    `./src/supabase.js?roleplay-persistence-test=${Date.now()}`
  );
  const result = await markRoleplayActivityForPhone(primaryPhone, {
    actor: 'test:roleplay',
    groupJid: '120363024420812768@g.us',
    phoneAliases: [lidPhone],
  });

  assert.equal(rpcAttempts, 1);
  assert.equal(result.updatedCount, 1, 'El alias LID debe encontrar al jugador aunque el PN sea primario.');
  assert.equal(result.unlockedPlayers.length, 0, 'Un bloqueo manual no debe notificarse como desbloqueado.');
  assert.equal(phoneActivityRows.some((row) => row.phone === primaryPhone), true);
  assert.equal(phoneActivityRows.some((row) => row.phone === lidPhone), true);
  assert.equal(accessUpdateRows[0].locked_at, manualLockedAt);
  assert.equal(accessUpdateRows[0].lock_reason, 'moderation_review');
  assert.deepEqual(accessLogRows.map((row) => row.action), ['roleplay_detected']);

  console.log('ROLEPLAY_PERSISTENCE_OK aliases=matched manual_lock=preserved fallback=covered');
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
