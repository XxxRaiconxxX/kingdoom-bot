import assert from 'node:assert/strict';
import 'dotenv/config';
import {
  ADMIN_COMMANDS,
  PRIVILEGED_COMMANDS,
  canRunAdminCommand,
  isKnownAdminCommand,
} from './src/adminCommands.js';
import { parseGoldAmount, requireSafeGoldInteger } from './src/economy.js';

const { calculateMultiplayerSettlement } = await import('./src/handlers/blackjack.js');
const { placeBet, resolveBet, transferGold, updateGold } = await import('./src/supabase.js');

assert.equal(parseGoldAmount('100'), 100);
assert.equal(parseGoldAmount('100.000'), 100000);
assert.equal(parseGoldAmount('0', { allowZero: true }), 0);
for (const invalid of ['', '0', '-100', '1.5', '1.2.3', '01', '100oro', '2147483648', '9007199254740992']) {
  assert.equal(parseGoldAmount(invalid), null, `Monto invalido aceptado: ${invalid}`);
}
assert.equal(requireSafeGoldInteger(-100, { allowNegative: true }), -100);
assert.throws(() => requireSafeGoldInteger(1.5), TypeError);
assert.throws(() => requireSafeGoldInteger(2_147_483_648), TypeError);
assert.throws(() => requireSafeGoldInteger(Number.MAX_SAFE_INTEGER + 1), TypeError);

for (const alias of ['ban', 'eliminar', 'kick']) {
  assert.equal(isKnownAdminCommand(alias), true);
  assert.equal(canRunAdminCommand(alias, { isAdmin: true }), true);
  assert.equal(canRunAdminCommand(alias, { isStaff: true }), false);
}
for (const command of ADMIN_COMMANDS) {
  const ownerOnly = ['add', 'remove', 'grupos', 'grupoactual'].includes(command);
  assert.equal(canRunAdminCommand(command, { isOwner: true }), true, command);
  assert.equal(canRunAdminCommand(command, { isAdmin: true }), !ownerOnly, command);
  assert.equal(canRunAdminCommand(command, { isStaff: true }), false, command);
}
for (const command of PRIVILEGED_COMMANDS) {
  assert.equal(canRunAdminCommand(command, { isStaff: true }), true, command);
  assert.equal(canRunAdminCommand(command, {}), false, command);
}

const card = (value) => ({ value, suit: { symbol: '' } });
const player = (id, values) => ({ playerId: id, betId: `bet-${id}`, cards: values.map(card) });

const tiedNaturals = calculateMultiplayerSettlement([
  player('a', ['A', 'K']),
  player('b', ['A', 'Q']),
], 100);
assert.equal(tiedNaturals.pot, 200);
assert.deepEqual(tiedNaturals.winners.map(({ payout }) => payout), [100, 100]);

const oddPot = calculateMultiplayerSettlement([
  player('a', ['10', '10']),
  player('b', ['K', 'Q']),
  player('c', ['K', 'Q', '5']),
], 101);
assert.deepEqual(oddPot.winners.map(({ payout }) => payout), [152, 151]);
assert.equal(oddPot.winners.reduce((sum, { payout }) => sum + payout, 0), oddPot.pot);

const allBust = calculateMultiplayerSettlement([
  player('a', ['K', 'Q', '5']),
  player('b', ['10', '9', '4']),
], 100);
assert.equal(allBust.winners.length, 0);

for (let playerCount = 2; playerCount <= 20; playerCount += 1) {
  for (let winnerCount = 1; winnerCount <= playerCount; winnerCount += 1) {
    const players = Array.from({ length: playerCount }, (_, index) => (
      index < winnerCount
        ? player(`winner-${index}`, ['10', '10'])
        : player(`loser-${index}`, ['K', 'Q', '5'])
    ));
    const settlement = calculateMultiplayerSettlement(players, 137);
    const paid = settlement.winners.reduce((sum, { payout }) => sum + payout, 0);
    assert.equal(paid, settlement.pot, `${playerCount} jugadores, ${winnerCount} ganadores`);
  }
}

await assert.rejects(updateGold('00000000-0000-0000-0000-000000000000', 1.5), TypeError);
await assert.rejects(transferGold('a', 'b', -1), TypeError);
await assert.rejects(placeBet('a', 0, 'dados'), TypeError);
await assert.rejects(placeBet('a', 10, ''), TypeError);
await assert.rejects(resolveBet('a', -1), TypeError);

console.log('CORE_MECHANICS_OK');
