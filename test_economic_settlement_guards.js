import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const readSource = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const gamesSource = readSource('./src/handlers/games.js');
const blackjackSource = readSource('./src/handlers/blackjack.js');
const treasureSource = readSource('./src/handlers/treasure.js');
const supabaseSource = readSource('./src/supabase.js');
const indexSource = readSource('./src/index.js');

assert.match(gamesSource, /cancelInterruptedBet\(betId, totalExposure/);
assert.match(gamesSource, /cancelInterruptedBet\(betId, totalApuesta/);
assert.match(gamesSource, /buildPendingSettlementCard\('Dados del destino'/);
assert.match(gamesSource, /buildPendingSettlementCard\('Trampa del Reino'/);
assert.match(gamesSource, /GOLD_CREDIT_UNCONFIRMED/);

assert.match(blackjackSource, /SOLO_SESSION_TIMEOUT_MS/);
assert.match(blackjackSource, /handleSoloBlackjackTimeout[\s\S]*resolveBet\(session\.betId, session\.bet\)/);
assert.match(blackjackSource, /if \(playerTotal > 21\)[\s\S]*resolveBet\(session\.betId, 0\)/);
assert.match(blackjackSource, /refundBlackjackPlayers\([\s\S]*resolveMultiplayerRound\.board/);
assert.match(blackjackSource, /buildBlackjackSettlementPending/);

assert.match(treasureSource, /buildTreasureClaimFeedback\(status/);
assert.match(treasureSource, /runTreasureClaimSerial/);
assert.match(treasureSource, /msg\.react\('\\u23F3'\)/);
assert.match(supabaseSource, /status: 'credit_pending'/);

assert.match(supabaseSource, /runBotUsageSerial/);
assert.match(supabaseSource, /throw new Error\('No se pudo consultar el contador diario\.'/);
assert.match(supabaseSource, /throw new Error\('No se pudo actualizar el contador diario\.'/);
assert.match(supabaseSource, /next > maxAllowed/);

assert.match(indexSource, /Reembolso pendiente para apuesta/);
assert.match(indexSource, /continue;[\s\S]*bot_notifications_queue/);

console.log('ECONOMIC_SETTLEMENT_GUARDS_OK');
