import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const { normalizePhone } = await import('./src/adminStore.js');
const { handleTreasureReply, buildTreasureClaimFeedback } = await import('./src/handlers/treasure.js');

console.log('=== RUNNING TESTS FOR DATA UPLOAD AND TREASURE CLAIM ===\n');

// 1. Test normalizePhone with multi-device JIDs
console.log('[Test 1] Multi-device JID normalization...');
assert.equal(normalizePhone('595981123456@c.us'), '595981123456');
assert.equal(normalizePhone('595981123456:12@c.us'), '595981123456');
assert.equal(normalizePhone('595981123456:4@s.whatsapp.net'), '595981123456');
assert.equal(normalizePhone('549341123456:9@c.us'), '549341123456');
assert.equal(normalizePhone('240797811245267@lid'), '240797811245267');
console.log('✅ normalizePhone multi-device JID test passed!');

// 2. Test Treasure claim feedback builder
console.log('\n[Test 2] Treasure claim feedback builder...');
const okFeedback = buildTreasureClaimFeedback('ok', { playerName: 'Raicon', rewardGold: 25000, currentGold: 150000 });
assert.ok(okFeedback.includes('Raicon'));
assert.ok(okFeedback.includes('25.000'));
assert.ok(okFeedback.includes('150.000'));

const mentionedFeedback = buildTreasureClaimFeedback('ok', {
  playerName: 'Raicon',
  playerPhone: '595981123456',
  rewardGold: 25000,
});
assert.ok(mentionedFeedback.includes('@595981123456'));

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

// 4. Guardas estructurales de !data sin tocar una base real.
console.log('\n[Test 4] !data structural guards...');
const adminSource = fs.readFileSync(new URL('./src/handlers/admin.js', import.meta.url), 'utf8');
assert.match(adminSource, /resolveAndDownloadMedia\(msg, client\)/);
assert.match(adminSource, /DATA_MAX_FILE_BYTES/);
assert.match(adminSource, /TextDecoder\('utf-8', \{ fatal: true \}\)/);
assert.doesNotMatch(adminSource, /mediaData\._blob|Método A|Método B/);
console.log('✅ !data structural guards passed!');

console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
