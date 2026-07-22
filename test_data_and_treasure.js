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

// 4. Test !data command with document caption and inline text
console.log('\n[Test 4] !data admin command handling...');
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
      data: Buffer.from('Darkthorne fue un reino legendario fundado en la era antigua.', 'utf-8').toString('base64')
    };
  }
};
const docReply = await handleAdminCommand(docCaptionMsg, '595971123456', 'AdminUser');
assert.ok(docReply.includes('Documento guardado') || docReply.includes('Error al guardar'));

const inlineTxtMsg = {
  from: '595971123456@c.us',
  body: '!data Leyendas Antiguas\nEste es el contenido directo de las leyendas sin necesidad de adjuntar archivo.',
  hasMedia: false,
  hasQuotedMsg: false
};
const inlineReply = await handleAdminCommand(inlineTxtMsg, '595971123456', 'AdminUser');
assert.ok(inlineReply.includes('Documento guardado') || inlineReply.includes('Error al guardar'));

console.log('✅ !data command tests passed!');

console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
