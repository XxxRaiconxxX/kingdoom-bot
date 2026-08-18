import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/handlers/player.js', import.meta.url), 'utf8');
const marketBlocks = source.match(/if \(command === 'mercado'\) \{/g) ?? [];

assert.equal(marketBlocks.length, 1, 'Debe existir una sola ruta de !mercado.');
assert.doesNotMatch(
  source,
  /if \(command === 'mercado'\)[\s\S]{0,1200}resolvePlayerTarget\(msg, identifier\)/,
  '!mercado no debe ejecutar la logica de transferencia de !oro.'
);

console.log('PLAYER_MARKET_SOURCE_OK');
