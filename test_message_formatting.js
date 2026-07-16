import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  decorateCommandReply,
  heraldCard,
  heraldCommand,
  heraldList,
  heraldStat,
} from './src/formatting.js';

const trapCard = heraldCard('Trampa del Reino', [
  '> _Nothing activo un mecanismo oscuro..._',
  heraldStat('Resultado', 'Jackpot x2'),
  heraldStat('Nuevo total', '1.451.606.470 oro'),
], { icon: '🕸️' });

assert.equal(
  trapCard,
  [
    '╭─ 🕸️ *Trampa del Reino*',
    '',
    '> _Nothing activo un mecanismo oscuro..._',
    '✦ *Resultado* · Jackpot x2',
    '✦ *Nuevo total* · 1.451.606.470 oro',
    '',
    '╰─ _Heraldo de Kingdoom_',
  ].join('\n')
);
assert.equal(decorateCommandReply('trampa', trapCard), trapCard);
assert.equal(
  heraldList([
    heraldCommand('!oro', 'Consulta tu fortuna.'),
    heraldCommand('!perfil', 'Muestra tu estado.'),
  ]),
  '- `!oro` · Consulta tu fortuna.\n- `!perfil` · Muestra tu estado.'
);

const errorCard = decorateCommandReply('dados', '❌ No tenes suficiente oro.\nTenes: 500');
assert.match(errorCard, /^╭─ 🎲 \*Dados del destino\*/u);
assert.match(errorCard, /\n\n❌ No tenes suficiente oro\.\nTenes: 500\n\n/u);
assert.doesNotMatch(errorCard, /│/u);

const commandSources = [
  'src/formatting.js',
  'src/handlers/admin.js',
  'src/handlers/auctions.js',
  'src/handlers/auctionsRealtime.js',
  'src/handlers/games.js',
  'src/handlers/player.js',
  'src/index.js',
];
const mojibakePattern = /[ÃÂ]|â[\u0080-\u00bf]|ðŸ/u;
const legacyFramePattern = /[╔╚]|═{6,}|━{6,}|─{16,}/u;

for (const file of commandSources) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(source, mojibakePattern, `${file} contiene texto mojibake`);
  if (file !== 'src/formatting.js') {
    assert.doesNotMatch(source, legacyFramePattern, `${file} contiene un marco heredado`);
  }
}

for (const file of ['src/handlers/auctions.js', 'src/handlers/auctionsRealtime.js']) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\*\*[^*]+\*\*/u, `${file} usa Markdown incompatible con WhatsApp`);
}

console.log('message formatting tests passed');
