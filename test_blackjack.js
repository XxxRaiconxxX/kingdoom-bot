import 'dotenv/config';
import { calculateHand } from './src/handlers/blackjack.js';

console.log('--- INICIANDO PRUEBAS DE BLACKJACK ---');

function runTest(hand, expectedScore, description) {
  const actualScore = calculateHand(hand);
  if (actualScore === expectedScore) {
    console.log(`✅ [OK] ${description}: ${actualScore}`);
  } else {
    console.error(`❌ [FAIL] ${description}: Esperaba ${expectedScore}, obtuve ${actualScore}`);
    process.exit(1);
  }
}

// Test case 1: Normal hand
runTest([
  { value: '5', suit: { symbol: '❤️' } },
  { value: '10', suit: { symbol: '♦️' } }
], 15, 'Mano simple: 5 + 10');

// Test case 2: Face cards
runTest([
  { value: 'J', suit: { symbol: '❤️' } },
  { value: 'Q', suit: { symbol: '♦️' } }
], 20, 'Mano con figuras: J + Q');

// Test case 3: Ace as 11
runTest([
  { value: 'A', suit: { symbol: '❤️' } },
  { value: '9', suit: { symbol: '♦️' } }
], 20, 'As como 11: A + 9');

// Test case 4: Ace adjusted to 1
runTest([
  { value: 'A', suit: { symbol: '❤️' } },
  { value: '9', suit: { symbol: '♦️' } },
  { value: '5', suit: { symbol: '♣️' } }
], 15, 'As como 1: A + 9 + 5');

// Test case 5: Multiple Aces
runTest([
  { value: 'A', suit: { symbol: '❤️' } },
  { value: 'A', suit: { symbol: '♦️' } },
  { value: 'A', suit: { symbol: '♣️' } }
], 13, 'Múltiples Ases: A + A + A');

// Test case 6: Safe message ID extraction from various replyMsg formats (LID, object without _serialized, etc.)
import { getWhatsAppMessageId } from './src/whatsappDelivery.js';
const testMsg1 = { id: { _serialized: 'true_123@g.us_ABC' } };
const testMsg2 = { id: { $1: 'true_123@g.us_DEF' } };
const testMsg3 = { id: 'true_123@g.us_GHI' };
const testMsg4 = { _data: { id: { _serialized: 'true_123@g.us_JKL' } } };

if (getWhatsAppMessageId(testMsg1) === 'true_123@g.us_ABC' &&
    getWhatsAppMessageId(testMsg2) === 'true_123@g.us_DEF' &&
    getWhatsAppMessageId(testMsg3) === 'true_123@g.us_GHI' &&
    getWhatsAppMessageId(testMsg4) === 'true_123@g.us_JKL') {
  console.log('✅ [OK] Extracción segura de IDs de replyMsg (evita doble respuesta/error ⚠️): OK');
} else {
  console.error('❌ [FAIL] Extracción segura de IDs falló');
  process.exit(1);
}

console.log('--- TODAS LAS PRUEBAS DE LOGICA PASARON EXITOSAMENTE ---');
process.exit(0);
