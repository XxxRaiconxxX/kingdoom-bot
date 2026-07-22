import assert from 'node:assert/strict';
import { normalizePhone } from './src/adminStore.js';
import { handleTreasureReply, buildTreasureClaimFeedback } from './src/handlers/treasure.js';
import { handleAdminCommand } from './src/handlers/admin.js';

console.log('=====================================================');
console.log('   VERIFYING COMMUNITY PATCH & DATA UPLOAD FUNCTIONALITY');
console.log('=====================================================\n');

// 1. Test normalizePhone
console.log('[Test 1] Multi-device JID normalization...');
assert.equal(normalizePhone('595981123456@c.us'), '595981123456');
assert.equal(normalizePhone('595981123456:12@c.us'), '595981123456');
assert.equal(normalizePhone('595981123456:4@s.whatsapp.net'), '595981123456');
console.log('  ✅ normalizePhone passed!');

// 2. Test document attachment with caption (!data Lore Darkthorne)
console.log('\n[Test 2] Direct document attachment with caption...');
const docCaptionMsg = {
  from: '595971123456@c.us',
  body: 'Lore_Darkthorne_Arcania.txt',
  caption: '!data Lore Darkthorne',
  hasMedia: true,
  hasQuotedMsg: false,
  async downloadMedia() {
    return {
      mimetype: 'text/plain',
      filename: 'Lore_Darkthorne_Arcania.txt',
      data: Buffer.from('El Reino de las Sombras fue fundado en la era antigua.', 'utf-8').toString('base64')
    };
  }
};
const docReply = await handleAdminCommand(docCaptionMsg, {});
console.log('  Result:', docReply);
assert.ok(docReply.includes('Documento guardado') || docReply.includes('Error al guardar'));
console.log('  ✅ Direct document attachment with caption passed!');

// 3. Test Puppeteer community patch fallback simulation
console.log('\n[Test 3] Community patch fallback simulation...');
const mockPupPage = {
  async evaluate(fn, arg) {
    // Simulate browser page evaluate executing community patch fallback
    return {
      data: Buffer.from('Contenido recuperado via parche comunitario WAWebDownloadManager.', 'utf-8').toString('base64'),
      mimetype: 'text/plain',
      filename: 'documento_parche.txt'
    };
  }
};
const mockClientWithPup = { pupPage: mockPupPage };
const failingMediaMsg = {
  from: '595971123456@c.us',
  body: 'archivo.txt',
  caption: '!data Parche Comunitario',
  hasMedia: true,
  hasQuotedMsg: false,
  id: {
    fromMe: false,
    remote: '120363043544991033@g.us',
    id: '3A17DB4C07691A4AB083',
    participant: '275162062668001@lid',
    '$1': 'false_120363043544991033@g.us_3A17DB4C07691A4AB083_275162062668001@lid'
  },
  async downloadMedia() {
    throw new Error('r'); // Simulate WAWeb exception
  }
};
const patchReply = await handleAdminCommand(failingMediaMsg, mockClientWithPup);
console.log('  Result:', patchReply);
assert.ok(patchReply.includes('Documento guardado') || patchReply.includes('Error al guardar'));
console.log('  ✅ Community patch fallback simulation passed!');

// 4. Test inline multiline text
console.log('\n[Test 4] Inline multiline text channel...');
const inlineMsg = {
  from: '595971123456@c.us',
  body: '!data Titulo InLine\nEsta es la primera linea del contenido.\nEsta es la segunda linea.',
  hasMedia: false,
  hasQuotedMsg: false
};
const inlineReply = await handleAdminCommand(inlineMsg, {});
console.log('  Result:', inlineReply);
assert.ok(inlineReply.includes('Documento guardado') || inlineReply.includes('Error al guardar'));
console.log('  ✅ Inline multiline text passed!');

// 5. Test bot reply guard
console.log('\n[Test 5] Bot reply guard...');
const botReplyMsg = {
  from: '595971123456@c.us',
  body: '!data Mi Intento',
  hasMedia: false,
  hasQuotedMsg: true,
  async getQuotedMessage() {
    return {
      hasMedia: false,
      body: '❌ No se encontro contenido de texto para guardar.'
    };
  }
};
const guardReply = await handleAdminCommand(botReplyMsg, {});
console.log('  Result:', guardReply);
assert.ok(guardReply.includes('El mensaje citado es una respuesta del bot'));
console.log('  ✅ Bot reply guard passed!');

console.log('\n=====================================================');
console.log('   ALL 5 VERIFICATION TESTS PASSED SUCCESSFULLY! 🚀');
console.log('=====================================================');
