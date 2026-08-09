import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';
process.env.COLOSSEUM_COMBAT_INTERVAL_MS = '10'; // Fast interval for testing

const { loadAllLoreRaces, generateColosseumFighter, pairColosseumFighters } = await import('./src/loreRaces.js');
const {
  createColosseumMatch,
  getActiveColosseumMatch,
  setColosseumMessageIds,
  findColosseumBetTargetByQuotedId,
  recordColosseumBet,
  closeColosseumBetting,
  recordColosseumRound,
  resolveColosseumWinner,
} = await import('./src/colosseumStore.js');
const { handleColiseo, handleApostarColiseo, startColosseumCombat } = await import('./src/handlers/colosseumHandler.js');

console.log('=== RUNNING TESTS FOR COLOSSEUM OF RACES AND PVP BETTING ===\n');

// 1. Test Lore Races Loader
console.log('[Test 1] Lore Races Catalog Loader...');
const races = loadAllLoreRaces();
assert.ok(races.length >= 8, `Debe haber al menos 8 razas cargadas (encontradas: ${races.length})`);
const sample = races[0];
assert.ok(sample.name, 'La raza debe tener nombre');
assert.ok(sample.faction, 'La raza debe tener facción');
assert.ok(Number.isFinite(sample.fue), 'FUE debe ser numérico');
assert.ok(Number.isFinite(sample.forceKn), 'forceKn debe ser numérico');
assert.ok(sample.passive, 'Debe tener rasgo pasivo');
assert.ok(sample.skill, 'Debe tener habilidad especial');
console.log(`✅ ${races.length} razas oficiales cargadas e indexadas exitosamente!`);

// 2. Test Fighter Generation & Pairing
console.log('\n[Test 2] Fighter Generation & Balanced Pairing...');
const fighter = generateColosseumFighter();
assert.ok(fighter.id, 'Fighter debe tener ID');
assert.ok(fighter.fullName, 'Fighter debe tener nombre completo');
assert.ok(fighter.maxHp >= 100, `HP máximo debe ser >= 100 (actual: ${fighter.maxHp})`);
assert.ok(fighter.metrics.forceKn > 0, 'forceKn debe ser > 0');
assert.ok(fighter.weapon, 'Debe tener arma equipada');

const { fighterA, fighterB } = pairColosseumFighters();
assert.notEqual(fighterA.raceKey, fighterB.raceKey, 'Los gladiadores emparejados deben ser de razas distintas');
assert.ok(fighterA.odds >= 1.30 && fighterA.odds <= 4.50, `Odds A deben ser válidas: ${fighterA.odds}`);
assert.ok(fighterB.odds >= 1.30 && fighterB.odds <= 4.50, `Odds B deben ser válidas: ${fighterB.odds}`);
console.log(`✅ Emparejamiento: [${fighterA.fullName} · ${fighterA.odds}x] vs [${fighterB.fullName} · ${fighterB.odds}x]`);

// 3. Test Colosseum Session & Quoted Bet Resolution
console.log('\n[Test 3] Colosseum Session & Betting by Quoting...');
const match = createColosseumMatch({
  fighterA,
  fighterB,
  chatId: 'main-group@g.us',
  bettingDurationMs: 60000,
  combatIntervalMs: 50,
});
assert.equal(getActiveColosseumMatch().id, match.id);

setColosseumMessageIds(match.id, {
  announcementMsgId: 'false_main-group@g.us_3EB0000_author@c.us',
  fighterAMsgId: 'false_main-group@g.us_3EB0101_author@c.us',
  fighterBMsgId: 'false_main-group@g.us_3EB0102_author@c.us',
});

assert.equal(findColosseumBetTargetByQuotedId('false_main-group@g.us_3EB0101_author@c.us'), 'A');
assert.equal(findColosseumBetTargetByQuotedId('3EB0101'), 'A');
assert.equal(findColosseumBetTargetByQuotedId('3EB0102'), 'B');
assert.equal(findColosseumBetTargetByQuotedId('unknown_id', '🪓 LUCHADOR B\n👑 KAELEN'), 'B');
assert.equal(findColosseumBetTargetByQuotedId('unknown_id', `🗡️ LUCHADOR A\n👑 ${fighterA.name}`), 'A');
assert.equal(findColosseumBetTargetByQuotedId('random_msg_999'), null);

const bet1 = recordColosseumBet(match, {
  playerPhone: '595987273405',
  username: 'Alexander',
  target: 'A',
  amount: 25000,
});
assert.equal(bet1.amount, 25000);
assert.equal(bet1.potentialPayout, Math.round(25000 * fighterA.odds));

const bet2 = recordColosseumBet(match, {
  playerPhone: '281006825320570',
  username: 'Cosa rosada',
  target: 'B',
  amount: 40000,
});
assert.equal(bet2.amount, 40000);
assert.equal(bet2.potentialPayout, Math.round(40000 * fighterB.odds));

// Prevent opposing bet exploit
assert.throws(() => {
  recordColosseumBet(match, {
    playerPhone: '595987273405',
    username: 'Alexander',
    target: 'B',
    amount: 10000,
  });
}, /No puedes apostar por ambos bandos/);

console.log('✅ Apuestas registradas por cita y protección anti-exploit verificadas!');

// 4. Test Combat Loop until 0 HP & Payout Settlement
console.log('\n[Test 4] Continuous Combat Simulation until 0 HP...');
closeColosseumBetting(match);
assert.equal(match.status, 'fighting');

// Simulate rounds until one drops to 0
let round = 1;
while (fighterA.currentHp > 0 && fighterB.currentHp > 0) {
  const dmg = 35;
  if (round % 2 !== 0) {
    fighterB.currentHp = Math.max(0, fighterB.currentHp - dmg);
  } else {
    fighterA.currentHp = Math.max(0, fighterA.currentHp - dmg);
  }
  recordColosseumRound(match, {
    attacker: round % 2 !== 0 ? fighterA.name : fighterB.name,
    defender: round % 2 !== 0 ? fighterB.name : fighterA.name,
    damage: dmg,
  });
  round += 1;
}

const simulatedWinner = fighterA.currentHp > 0 ? 'A' : 'B';
assert.ok(fighterA.currentHp === 0 || fighterB.currentHp === 0, 'Al menos un luchador debe haber caído a 0 HP');

const settlement = resolveColosseumWinner(match, simulatedWinner);
assert.ok(settlement.winnerName);
assert.ok(settlement.totalDistributedGold >= 0);
if (simulatedWinner === 'A') {
  assert.equal(settlement.winnersCount, 1);
  assert.equal(settlement.winners[0].username, 'Alexander');
} else {
  assert.equal(settlement.winnersCount, 1);
  assert.equal(settlement.winners[0].username, 'Cosa rosada');
}
console.log(`✅ Combate finalizado en el Asalto ${round - 1}. Vencedor: ${settlement.winnerName} (${settlement.winnerOdds}x)`);

// 5. Test Live Handler Responses
console.log('\n[Test 5] Colosseum Handler Full Integration...');
const sentMessages = [];
const mockClient = {
  async sendMessage(to, text, opts) {
    const msgId = `mock_${Date.now()}_${sentMessages.length}`;
    sentMessages.push({ to, text, opts, id: { _serialized: msgId } });
    return { id: { _serialized: msgId }, to, text };
  },
};

const fakeMsg = {
  from: '120363410116763398@g.us',
  author: '595987273405',
  body: '!coliseo 1',
};

await handleColiseo(fakeMsg, mockClient, '1');
assert.ok(sentMessages.length >= 3, 'Debe enviar anuncio + Ficha A + Ficha B');
assert.ok(sentMessages[0].text.includes('𝕲𝖗𝖆𝖓 𝕮𝖔𝖑𝖎𝖘𝖊𝖔'));
assert.ok(sentMessages[1].text.includes('LUCHADOR A'));
assert.ok(sentMessages[2].text.includes('LUCHADOR B'));
console.log('✅ Mensajes de presentación generados con formato medieval y tarjetas técnicas!');

console.log('\n=== ALL COLOSSEUM TESTS PASSED SUCCESSFULLY! ===');
