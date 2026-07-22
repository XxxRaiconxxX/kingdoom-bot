import assert from 'node:assert/strict';
import fs from 'node:fs';
import { downloadMessageMedia, resolveMediaMessage } from './src/whatsappMedia.js';

console.log('=== VERIFYING CURRENT WHATSAPP MEDIA COMPATIBILITY ===');

let nativeCalls = 0;
const nativeMessage = {
  hasMedia: true,
  async downloadMedia() {
    nativeCalls += 1;
    return {
      data: Buffer.from('Contenido nativo.', 'utf8').toString('base64'),
      mimetype: 'text/plain',
      filename: 'nativo.txt',
    };
  },
};
const nativeMedia = await downloadMessageMedia(nativeMessage, null, { retryDelayMs: 0 });
assert.equal(Buffer.from(nativeMedia.data, 'base64').toString('utf8'), 'Contenido nativo.');
assert.equal(nativeCalls, 1, 'La API pública debe ser el primer camino de descarga.');

let fallbackCalls = 0;
const syntheticMessage = {
  hasMedia: true,
  _data: {
    directPath: '/mock/document',
    mediaKey: 'mock-key',
    mimetype: 'text/plain',
    filename: 'fallback.txt',
  },
};
const fallbackMedia = await downloadMessageMedia(syntheticMessage, {
  pupPage: {
    async evaluate() {
      fallbackCalls += 1;
      return {
        data: Buffer.from('Contenido recuperado.', 'utf8').toString('base64'),
        mimetype: 'text/plain',
        filename: 'fallback.txt',
      };
    },
  },
});
assert.equal(Buffer.from(fallbackMedia.data, 'base64').toString('utf8'), 'Contenido recuperado.');
assert.equal(fallbackCalls, 1);

const syntheticQuote = await resolveMediaMessage({
  hasQuotedMsg: true,
  async getQuotedMessage() { throw new Error('r'); },
  _data: {
    quotedMsg: {
      id: { $1: 'quoted-lid-message' },
      type: 'document',
      directPath: '/quoted/document',
      mediaKey: 'quoted-key',
      mimetype: 'text/plain',
      filename: 'quoted.txt',
    },
  },
});
assert.equal(syntheticQuote.id, 'quoted-lid-message');
assert.equal(syntheticQuote.hasMedia, true);

const adminSource = fs.readFileSync(new URL('./src/handlers/admin.js', import.meta.url), 'utf8');
assert.match(adminSource, /El mensaje citado es una respuesta del bot/);
assert.doesNotMatch(adminSource, /WAWebCollections|mediaData\._blob/);

console.log('COMMUNITY_MEDIA_COMPAT_OK');
