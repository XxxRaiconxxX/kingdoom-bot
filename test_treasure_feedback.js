import assert from 'node:assert/strict';
import 'dotenv/config';
import { buildTreasureClaimFeedback, handleTreasureReply } from './src/handlers/treasure.js';

const statuses = ['ok', 'duplicate', 'credit_pending', 'expired', 'full', 'error', 'unexpected'];
for (const status of statuses) {
  const message = buildTreasureClaimFeedback(status, {
    playerName: 'Grindelwald',
    rewardGold: 12500,
    currentGold: 50000,
  });
  assert.ok(message.length > 0, `${status} debe producir una respuesta visible`);
  assert.match(message, /^╭─/u);
}

assert.match(
  buildTreasureClaimFeedback('ok', {
    playerName: 'Grindelwald',
    rewardGold: 12500,
    currentGold: 50000,
  }),
  /Recompensa acreditada.*12\.500 oro/su
);

assert.match(
  buildTreasureClaimFeedback('credit_pending', {
    playerName: 'Grindelwald',
    rewardGold: 12500,
  }),
  /Recompensa reservada.*12\.500 oro/su
);

const closedReply = await handleTreasureReply(
  { from: '595971938097-1618930274@g.us', body: 'Reclamar' },
  { status: 'claimed' },
  'message-id',
  {}
);
assert.match(closedReply, /Tesoro agotado/u);

console.log('TREASURE_FEEDBACK_OK');
