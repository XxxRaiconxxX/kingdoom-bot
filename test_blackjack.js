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

console.log('--- TODAS LAS PRUEBAS DE LOGICA PASARON EXITOSAMENTE ---');
process.exit(0);
