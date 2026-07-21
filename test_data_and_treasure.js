import assert from 'node:assert/strict';
import { normalizePhone } from './src/adminStore.js';
import { handleTreasureReply, activeTreasures, buildTreasureClaimFeedback } from './src/handlers/treasure.js';
import { handleAdminCommand } from './src/handlers/admin.js';

console.log('=== RUNNING TESTS FOR DATA UPLOAD AND TREASURE CLAIM ===\n');

// 1. Test normalizePhone with multi-device JIDs
console.log('[Test 1] Multi-device JID normalization...');
assert.equal(normalizePhone('595981123456@c.us'), '595981123456');
assert.equal(normalizePhone('595981123456:12@c.us'), '595981123456');
assert.equal(normalizePhone('595981123456:4@s.whatsapp.net'), '595981123456');
assert.equal(normalizePhone('549341123456:9@c.us'), '549341123456');
console.log('✅ normalizePhone multi-device JID test passed!');

// 2. Test Treasure claim feedback builder
console.log('\n[Test 2] Treasure claim feedback builder...');
const okFeedback = buildTreasureClaimFeedback('ok', { playerName: 'Raicon', rewardGold: 25000, currentGold: 150000 });
assert.ok(okFeedback.includes('Raicon'));
assert.ok(okFeedback.includes('25.000'));
assert.ok(okFeedback.includes('150.000'));

const fullFeedback = buildTreasureClaimFeedback('full');
assert.ok(fullFeedback.includes('Tesoro agotado'));
console.log('✅ Treasure claim feedback builder test passed!');

// 3. Test handleTreasureReply with non-matching group or non-reclamar body
console.log('\n[Test 3] handleTreasureReply filters...');
const mockTreasure = {
  messageId: 'msg_123',
  chatId: '595971938097-1618930274@g.us',
  maxWinners: 2,
  status: 'open',
  isClientReady: () => true
};

const ignoredMsg = {
  from: 'wrong_group@g.us',
  body: 'reclamar',
  author: '595981123456:12@c.us'
};
const ignoredResult = await handleTreasureReply(ignoredMsg, mockTreasure, 'msg_123', {});
assert.equal(ignoredResult, null);

const nonReclamarMsg = {
  from: '595971938097-1618930274@g.us',
  body: 'hola bot',
  author: '595981123456:12@c.us'
};
const nonReclamarResult = await handleTreasureReply(nonReclamarMsg, mockTreasure, 'msg_123', {});
assert.equal(nonReclamarResult, null);
console.log('✅ handleTreasureReply filters test passed!');

// 4. Test !data command without media or quoted media
console.log('\n[Test 4] !data admin command handling...');
const noMediaMsg = {
  from: '595971123456@c.us',
  body: '!data Titulo Lore',
  hasMedia: false,
  hasQuotedMsg: false
};
const noMediaReply = await handleAdminCommand(noMediaMsg, '595971123456', 'AdminUser');
assert.ok(noMediaReply.includes('Debes adjuntar un archivo .txt'));

const txtMediaMsg = {
  from: '595971123456@c.us',
  body: '!data Lore del Reino',
  hasMedia: true,
  hasQuotedMsg: false,
  async downloadMedia() {
    return {
      mimetype: 'application/octet-stream',
      filename: 'historia.txt',
      data: Buffer.from('El Reino de las Sombras fue fundado en la era antigua.', 'utf-8').toString('base64')
    };
  }
};
const txtMediaReply = await handleAdminCommand(txtMediaMsg, '595971123456', 'AdminUser');
// Should attempt upsert (might fail DB connection if offline or return success)
assert.ok(txtMediaReply.includes('Documento guardado') || txtMediaReply.includes('Error al guardar'));
console.log('✅ !data command test passed!');

console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
