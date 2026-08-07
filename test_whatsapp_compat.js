import assert from 'node:assert/strict';
import { formatJid, normalizePhone } from './src/adminStore.js';
import {
  clearWhatsAppIdentityCache,
  resolveContactPhone,
  resolveMessageSenderPhone,
  resolveWhatsAppPhone,
  resolveWhatsAppPhones,
  resolveWhatsAppRecipientId,
  serializeWhatsAppId,
} from './src/whatsappIdentity.js';
import {
  downloadMessageMedia,
  resolveMediaMessage,
} from './src/whatsappMedia.js';

assert.equal(normalizePhone('595981123456:12@c.us'), '595981123456');
assert.equal(normalizePhone('240797811245267@lid'), '240797811245267', 'LID digits are preserved for player lookups.');
assert.equal(normalizePhone('275162062668001@lid'), '595987273405', 'Se conserva el alias histórico del owner.');
assert.equal(normalizePhone('595971938097-1618930274@g.us'), '', 'Un grupo no puede convertirse en teléfono.');
assert.equal(formatJid('123456789012345'), '123456789012345@lid', '14+ digit IDs format as @lid.');
assert.equal(formatJid('240797811245267@lid'), '240797811245267@lid');
assert.equal(serializeWhatsAppId({ $1: '240797811245267@lid' }), '240797811245267@lid');

let recipientLookupPhone = '';
let recipientMappingInput = [];
assert.equal(
  await resolveWhatsAppRecipientId({
    async getNumberId(number) {
      recipientLookupPhone = number;
      return { _serialized: '595981111222@c.us' };
    },
    async getContactLidAndPhone(ids) {
      recipientMappingInput = ids;
      return [{ lid: '240797811245267@lid', pn: '595981111222@c.us' }];
    },
  }, '595981111222'),
  '240797811245267@lid'
);
assert.equal(recipientLookupPhone, '595981111222');
assert.deepEqual(recipientMappingInput, ['595981111222@c.us']);
assert.equal(
  await resolveWhatsAppRecipientId({
    getNumberId: async () => ({ _serialized: '595981111222@c.us' }),
  }, '595981111222'),
  '595981111222@c.us'
);
assert.equal(
  await resolveWhatsAppRecipientId({ getNumberId: async () => null }, '595981111222'),
  ''
);
await assert.rejects(
  resolveWhatsAppRecipientId({}, '595981111222'),
  /does not support getNumberId/
);

clearWhatsAppIdentityCache();
let mappingCalls = 0;
const identityClient = {
  async getContactLidAndPhone(ids) {
    mappingCalls += 1;
    assert.deepEqual(ids, ['240797811245267@lid']);
    return [{ lid: ids[0], pn: '595981111222@c.us' }];
  },
};
assert.equal(await resolveWhatsAppPhone(identityClient, '240797811245267@lid'), '595981111222');
assert.equal(await resolveWhatsAppPhone(identityClient, '240797811245267@lid'), '595981111222');
assert.equal(mappingCalls, 1, 'La caché debe evitar consultas LID duplicadas.');

clearWhatsAppIdentityCache();
assert.equal(
  await resolveMessageSenderPhone({
    author: '111111111111111@lid',
    async getContact() {
      return { id: { _serialized: '595982222333@c.us' }, number: '595982222333' };
    },
  }, identityClient),
  '595982222333'
);
assert.equal(
  await resolveContactPhone(identityClient, {
    id: { _serialized: '595983333444@c.us' },
    number: '595983333444',
  }),
  '595983333444'
);

clearWhatsAppIdentityCache();
const batchClient = {
  async getContactLidAndPhone(ids) {
    return [{ lid: ids[0], pn: ids[0].startsWith('1') ? '595984444555@c.us' : undefined }];
  },
};
const batch = await resolveWhatsAppPhones(batchClient, [
  '595985555666@c.us',
  '111111111111111@lid',
  '222222222222222@lid',
]);
assert.deepEqual(batch.phones, ['595985555666', '595984444555']);
assert.deepEqual(batch.unresolved, ['222222222222222@lid']);

let nativeDownloads = 0;
let reloads = 0;
const nativeMediaMessage = {
  hasMedia: true,
  async downloadMedia() {
    nativeDownloads += 1;
    return nativeDownloads === 1
      ? undefined
      : { data: 'dGV4dG8=', mimetype: 'text/plain', filename: 'lore.txt' };
  },
  async reload() {
    reloads += 1;
  },
};
const nativeMedia = await downloadMessageMedia(nativeMediaMessage, null, { retryDelayMs: 0 });
assert.equal(nativeMedia.data, 'dGV4dG8=');
assert.equal(nativeDownloads, 2);
assert.equal(reloads, 1);

let rawFallbackCalls = 0;
const rawMedia = await downloadMessageMedia({
  hasMedia: true,
  _data: {
    directPath: '/media/path',
    mediaKey: 'key',
    mimetype: 'text/plain',
    filename: 'fallback.txt',
  },
}, {
  pupPage: {
    async evaluate() {
      rawFallbackCalls += 1;
      return { data: 'ZmFsbGJhY2s=', mimetype: 'text/plain', filename: 'fallback.txt' };
    },
  },
});
assert.equal(rawMedia.data, 'ZmFsbGJhY2s=');
assert.equal(rawFallbackCalls, 1);

const quoted = { hasMedia: false, body: 'texto citado' };
assert.equal(await resolveMediaMessage({
  hasQuotedMsg: true,
  async getQuotedMessage() { return quoted; },
}), quoted);

console.log('WHATSAPP_COMPAT_OK');
