import { createDeck, shuffle } from './src/handlers/blackjack.js';

console.log('--- INICIANDO PRUEBAS DE SHUFFLE ---');

function runTest() {
  const deck = createDeck();
  if (deck.length !== 52) {
    console.error('❌ [FAIL] La baraja creada no tiene 52 cartas. Tiene ' + deck.length);
    process.exit(1);
  } else {
    console.log('✅ [OK] La baraja creada tiene 52 cartas.');
  }

  // Clone original deck to compare later
  const originalDeckStr = JSON.stringify(deck);

  const shuffledDeck = shuffle([...deck]);

  if (shuffledDeck.length !== 52) {
    console.error('❌ [FAIL] La baraja mezclada no tiene 52 cartas. Tiene ' + shuffledDeck.length);
    process.exit(1);
  } else {
    console.log('✅ [OK] La baraja mezclada tiene 52 cartas.');
  }

  const shuffledDeckStr = JSON.stringify(shuffledDeck);

  if (originalDeckStr === shuffledDeckStr) {
    console.error('❌ [FAIL] La baraja mezclada tiene el mismo orden que la original.');
    process.exit(1);
  } else {
    console.log('✅ [OK] La baraja fue mezclada con éxito, el orden es diferente.');
  }

  console.log('--- TODAS LAS PRUEBAS DE SHUFFLE PASARON EXITOSAMENTE ---');
}

runTest();
