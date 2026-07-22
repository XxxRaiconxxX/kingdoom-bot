import assert from 'node:assert/strict';
import http from 'node:http';

const playerId = '00000000-0000-4000-8000-000000000001';
const phone = '595981111111';
const legacyPhone = `5959${phone.slice(3)}`;
let playerReads = 0;
let lastPlayerRequestUrl = '';

const server = http.createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');

  if (request.url?.startsWith('/rest/v1/players')) {
    playerReads += 1;
    lastPlayerRequestUrl = decodeURIComponent(request.url);
    response.end(JSON.stringify([
      {
        id: playerId,
        username: 'AuditPlayer',
        gold: 100,
        weekly_gold: 0,
        phone: legacyPhone,
        is_admin: false,
        banned: false,
        created_at: '2026-01-01T00:00:00.000Z',
        last_active_at: null,
      },
    ]));
    return;
  }

  if (request.url === '/rest/v1/rpc/increment_gold') {
    response.end(JSON.stringify([{ success: true, message: 'ok', new_gold: 101 }]));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ message: 'not found' }));
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
assert.ok(address && typeof address === 'object');

process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`;
process.env.SUPABASE_SERVICE_KEY = 'audit-service-key';
process.env.PHONE_LOOKUP_TTL_MS = '60000';

try {
  const { getPlayersByPhone, updateGold } = await import(
    `./src/supabase.js?cache-test=${Date.now()}`
  );

  const burst = await Promise.all(
    Array.from({ length: 20 }, () => getPlayersByPhone(`${phone}@c.us`))
  );

  assert.equal(playerReads, 1, 'Concurrent lookups for one phone must share one request.');
  assert.equal(burst.every((players) => players[0]?.id === playerId), true);
  assert.match(lastPlayerRequestUrl, new RegExp(legacyPhone));

  await getPlayersByPhone(phone);
  assert.equal(playerReads, 1, 'A warm lookup must use the TTL cache.');

  await updateGold(playerId, 1);
  await getPlayersByPhone(phone);
  assert.equal(playerReads, 2, 'A balance mutation must invalidate the cached player.');

  console.log('PHONE_LOOKUP_CACHE_OK concurrent=20 reads=2 historical_variant=matched');
} finally {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
