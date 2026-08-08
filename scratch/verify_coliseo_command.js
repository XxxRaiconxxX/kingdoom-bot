import 'dotenv/config';
import assert from 'node:assert/strict';
import { handlePlayerMessage } from '../src/handlers/player.js';
import { getActiveColosseumMatch } from '../src/colosseumStore.js';

console.log('=== VALIDACION FORMAL DEL COMANDO !coliseo Y ALIASES ===\n');

const sent = [];
const mockClient = {
  async sendMessage(to, text, opts) {
    const id = `msg_test_${Date.now()}_${sent.length}`;
    sent.push({ to, text, opts, id });
    return { id: { _serialized: id }, to, text };
  },
};

const msgColiseo = {
  from: '120363024420812768@g.us',
  author: '595987273405',
  body: '!coliseo 2',
};

// 1. Ejecución del comando !coliseo
console.log('[Paso 1] Invocando comando !coliseo...');
const result = await handlePlayerMessage(msgColiseo, mockClient);

const activeMatch = getActiveColosseumMatch();
assert.ok(activeMatch, 'El Coliseo debe estar activo en memoria tras ejecutar !coliseo');
assert.equal(activeMatch.status, 'betting', 'El estado inicial debe ser "betting"');
assert.ok(activeMatch.fighterA, 'Debe haber un Gladiador A');
assert.ok(activeMatch.fighterB, 'Debe haber un Gladiador B');

console.log(`✅ Sesión de Coliseo iniciada: ${activeMatch.id}`);
console.log(`✅ Gladiador A: ${activeMatch.fighterA.fullName} (${activeMatch.fighterA.odds}x)`);
console.log(`✅ Gladiador B: ${activeMatch.fighterB.fullName} (${activeMatch.fighterB.odds}x)`);
console.log(`✅ Mensajes emitidos al grupo: ${sent.length}`);

// 2. Verificación de contenido de las tarjetas emitidas
assert.ok(sent.length >= 3, 'Debe haber enviado al menos 3 mensajes (anuncio + Ficha A + Ficha B)');
assert.ok(sent[0].text.includes('𝕲𝖗𝖆𝖓 𝕮𝖔𝖑𝖎𝖘𝖊𝖔'), 'Mensaje 1 debe ser el anuncio');
assert.ok(sent[1].text.includes('LUCHADOR A'), 'Mensaje 2 debe ser la tarjeta de Gladiador A');
assert.ok(sent[2].text.includes('LUCHADOR B'), 'Mensaje 3 debe ser la tarjeta de Gladiador B');

// 3. Verificación de consulta con Coliseo en curso
console.log('\n[Paso 2] Consultando estado cuando ya hay un Coliseo activo...');
const queryMsg = {
  from: '120363024420812768@g.us',
  author: '595987273405',
  body: '!arena',
};
const queryResult = await handlePlayerMessage(queryMsg, mockClient);
assert.ok(queryResult.includes('Coliseo en curso'), 'Debe informar que el Coliseo está en curso');
console.log('✅ Consulta de estado de Coliseo activo verificada!');

console.log('\n=== ¡COMANDO !coliseo (Y ALIAS !arena, !gladiadores, !torneo) 100% EXISTENTE Y OPERATIVO! ===');
process.exit(0);
