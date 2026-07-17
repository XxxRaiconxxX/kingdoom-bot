import assert from 'node:assert/strict';
import fs from 'node:fs';
import 'dotenv/config';
import {
  buildTreasureClaimFeedback,
  handleTreasureReply,
  waitForTreasureAckBestEffort,
} from './src/handlers/treasure.js';

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

const treasureSource = fs.readFileSync(
  new URL('./src/handlers/treasure.js', import.meta.url),
  'utf8'
);
const persistEventIndex = treasureSource.indexOf('const event = await createTreasureEvent');
const waitForAckIndex = treasureSource.indexOf(
  'const ackConfirmed = await waitForTreasureAckBestEffort'
);
assert.ok(persistEventIndex >= 0, 'El drop debe persistir el evento de tesoro.');
assert.ok(
  waitForAckIndex > persistEventIndex,
  'El tesoro debe persistirse antes de esperar el ACK de WhatsApp.'
);

const pendingAckMessage = {
  ack: 0,
  id: { _serialized: 'treasure-ack-test' },
};
const rejectedAckClient = {
  on(event, handler) {
    if (event === 'message_ack') {
      queueMicrotask(() => handler(pendingAckMessage, -1));
    }
  },
  off() {},
};
const originalWarn = console.warn;
console.warn = () => {};
try {
  assert.equal(
    await waitForTreasureAckBestEffort(rejectedAckClient, pendingAckMessage),
    false,
    'Un ACK perdido no debe invalidar un tesoro ya persistido.'
  );
} finally {
  console.warn = originalWarn;
}

console.log('TREASURE_FEEDBACK_OK');
