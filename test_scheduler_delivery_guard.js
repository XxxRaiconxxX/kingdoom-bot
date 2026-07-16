import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import {
  isPermanentWhatsappRecipientError,
  isTransientWhatsappDeliveryError,
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
  (error) => error.code === 'WHATSAPP_ACK_TIMEOUT'
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

const schedulerSource = fs.readFileSync(new URL('./src/scheduler.js', import.meta.url), 'utf8');
assert.ok(
  schedulerSource.indexOf('waitForMessageServerAck(client, sentMessage)') <
    schedulerSource.indexOf(".update({ sent: true, sent_at:"),
  'The queue must wait for server ACK before marking a notification as sent.'
);

const treasureSource = fs.readFileSync(new URL('./src/handlers/treasure.js', import.meta.url), 'utf8');
assert.ok(
  treasureSource.indexOf('waitForMessageServerAck(client, message)') <
    treasureSource.indexOf('const event = await createTreasureEvent'),
  'A treasure must receive server ACK before its active event is persisted.'
);

console.log('SCHEDULER_DELIVERY_GUARD_OK');
