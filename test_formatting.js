import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heraldCard } from './src/formatting.js';

test('Basic card with only title', () => {
  assert.equal(
    heraldCard('Stats'),
    '╭─〔 *Stats* 〕\n\n╰────────────────────'
  );
});

test('Card with lines', () => {
  assert.equal(
    heraldCard('Inventory', ['Sword', 'Shield']),
    '╭─〔 *Inventory* 〕\n│ Sword\n│ Shield\n╰────────────────────'
  );
});

test('Card with custom icon', () => {
  assert.equal(
    heraldCard('Alert', ['Warning'], { icon: '⚠️' }),
    '╭─〔 ⚠️ *Alert* 〕\n│ Warning\n╰────────────────────'
  );
});

test('Card with custom body prefix and footer', () => {
  assert.equal(
    heraldCard('Custom', ['Line 1', 'Line 2'], { bodyPrefix: '║ ', footer: '╚════════════════════' }),
    '╭─〔 *Custom* 〕\n║ Line 1\n║ Line 2\n╚════════════════════'
  );
});

test('Card handling multi-line and empty strings correctly', () => {
  assert.equal(
    heraldCard('Complex Lines', ['Line 1\nSubline 1', null, '  \n', 'Line 2  ']),
    '╭─〔 *Complex Lines* 〕\n│ Line 1\n│ Subline 1\n│ Line 2\n╰────────────────────'
  );
});
