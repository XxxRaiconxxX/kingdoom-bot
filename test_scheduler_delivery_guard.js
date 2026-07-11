import assert from 'node:assert/strict';
import { isTransientWhatsappDeliveryError } from './src/whatsappDelivery.js';

assert.equal(
  isTransientWhatsappDeliveryError(new Error('Execution context was destroyed, most likely because of a navigation.')),
  true
);
assert.equal(
  isTransientWhatsappDeliveryError(new Error("Cannot read properties of undefined (reading 'getChat')")),
  true
);
assert.equal(isTransientWhatsappDeliveryError(new Error('Invalid WhatsApp recipient')), false);

console.log('SCHEDULER_DELIVERY_GUARD_OK');
