import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import {
  decideTrackedDelivery,
  getWhatsAppMessageId,
  inspectMessageServerAck,
  isPermanentWhatsappRecipientError,
  isTransientWhatsappDeliveryError,
  sendMessageWithResult,
  sendMessageWithServerAck,
  WHATSAPP_AMBIGUOUS_DELIVERY_HOLD_MS,
  waitForMessageServerAck,
} from './src/whatsappDelivery.js';

assert.equal(
  isTransientWhatsappDeliveryError(new Error('Execution context was destroyed, most likely because of a navigation.')),
  true
);
assert.equal(
  isTransientWhatsappDeliveryError(new Error("Cannot read properties of undefined (reading 'getChat')")),
  true
);
assert.equal(isTransientWhatsappDeliveryError(new Error('Invalid WhatsApp recipient')), false);
assert.equal(isPermanentWhatsappRecipientError(new Error('Invalid WhatsApp recipient')), true);
assert.equal(
  getWhatsAppMessageId({ _data: { id: { _serialized: 'message-from-data' } } }),
  'message-from-data'
);
assert.equal(
  getWhatsAppMessageId({ id: { fromMe: true, remote: 'group@g.us', id: 'message-object' } }),
  'message-object'
);

let sendOptions;
const sendClient = new EventEmitter();
sendClient.sendMessage = async (_chatId, content, options) => {
  sendOptions = options;
  queueMicrotask(() => {
    sendClient.emit('message_create', {
      fromMe: true,
      to: 'other-group@g.us',
      body: content,
      timestamp: Math.floor(Date.now() / 1000),
      id: { _serialized: 'wrong-chat-message' },
      ack: 1,
    });
    sendClient.emit('message_create', {
      fromMe: true,
      to: _chatId,
      body: content,
      timestamp: Math.floor(Date.now() / 1000),
      _data: { id: { _serialized: 'message-result' }, ack: 1 },
    });
  });
  return undefined;
};
const sentResult = await sendMessageWithResult(sendClient, 'group@g.us', 'test');
assert.equal(sentResult.messageId, 'message-result');
assert.equal(sentResult.source, 'message_create');
assert.equal(sendOptions.waitUntilMsgSent, true);
assert.equal(sendClient.listenerCount('message_create'), 0);
const ackedMessage = await sendMessageWithServerAck(sendClient, 'group@g.us', 'test');
assert.equal(getWhatsAppMessageId(ackedMessage), 'message-result');

const directResult = await sendMessageWithResult(
  {
    async sendMessage() {
      return { id: { _serialized: 'direct-result' }, ack: 1 };
    },
  },
  'group@g.us',
  'direct test'
);
assert.equal(directResult.messageId, 'direct-result');
assert.equal(directResult.source, 'send_result');

const ambiguousClient = new EventEmitter();
ambiguousClient.sendMessage = async (chatId, content) => {
  queueMicrotask(() => {
    ambiguousClient.emit('message_create', {
      fromMe: true,
      to: chatId,
      body: content,
      timestamp: Math.floor(Date.now() / 1000),
      id: { _serialized: 'ambiguous-result' },
      ack: 1,
    });
  });
  throw new Error('Evaluation context changed after send');
};
const ambiguousResult = await sendMessageWithResult(
  ambiguousClient,
  'group@g.us',
  'ambiguous test'
);
assert.equal(ambiguousResult.messageId, 'ambiguous-result');
assert.equal(ambiguousResult.source, 'message_create');
assert.equal(ambiguousClient.listenerCount('message_create'), 0);

const client = new EventEmitter();
client.getMessageById = async () => ({ ack: 0 });
const ackPromise = waitForMessageServerAck(
  client,
  { id: { _serialized: 'message-1' }, ack: 0 },
  100
);
queueMicrotask(() => {
  client.emit('message_ack', { id: { _serialized: 'message-1' } }, 1);
});
assert.equal(await ackPromise, true);

const timeoutClient = new EventEmitter();
timeoutClient.getMessageById = async () => ({ ack: 0 });
await assert.rejects(
  waitForMessageServerAck(
    timeoutClient,
    { id: { _serialized: 'message-2' }, ack: 0 },
    5
  ),
  (error) => error.code === 'WHATSAPP_ACK_TIMEOUT' && error.messageId === 'message-2'
);

const hangingLookupClient = new EventEmitter();
hangingLookupClient.getMessageById = () => new Promise(() => {});
const hangingLookupStartedAt = Date.now();
await assert.rejects(
  waitForMessageServerAck(
    hangingLookupClient,
    { id: { _serialized: 'message-3' }, ack: 0 },
    5
  ),
  (error) => error.code === 'WHATSAPP_ACK_TIMEOUT'
);
assert.ok(
  Date.now() - hangingLookupStartedAt < 500,
  'A zombie page lookup must not leave ACK confirmation hanging.'
);

assert.deepEqual(
  await inspectMessageServerAck({ getMessageById: async () => ({ ack: 1 }) }, 'tracked-1'),
  { state: 'acknowledged', ack: 1 }
);
assert.deepEqual(
  await inspectMessageServerAck({ getMessageById: async () => ({ ack: 0 }) }, 'tracked-2'),
  { state: 'pending', ack: 0 }
);
assert.deepEqual(
  await inspectMessageServerAck({ getMessageById: async () => null }, 'tracked-3'),
  { state: 'missing', ack: null }
);

const now = Date.now();
const recentTrackedItem = {
  delivery_message_id: 'tracked-1',
  delivery_started_at: new Date(now - 60_000).toISOString(),
};
assert.equal(decideTrackedDelivery(recentTrackedItem, { state: 'acknowledged' }, now), 'mark_sent');
assert.equal(decideTrackedDelivery(recentTrackedItem, { state: 'pending' }, now), 'hold');
assert.equal(decideTrackedDelivery(recentTrackedItem, { state: 'rejected' }, now), 'retry');
assert.equal(
  decideTrackedDelivery({
    ...recentTrackedItem,
    delivery_started_at: new Date(now - WHATSAPP_AMBIGUOUS_DELIVERY_HOLD_MS - 1).toISOString(),
  }, { state: 'missing' }, now),
  'retry'
);

const treasureSource = fs.readFileSync(new URL('./src/handlers/treasure.js', import.meta.url), 'utf8');
assert.ok(
  treasureSource.indexOf('await sendMessageWithResult(client, TARGET_GROUP, text)') <
    treasureSource.indexOf('const event = await createTreasureEvent'),
  'A treasure must obtain its stable message id before its active event is persisted.'
);

console.log('SCHEDULER_DELIVERY_GUARD_OK');
