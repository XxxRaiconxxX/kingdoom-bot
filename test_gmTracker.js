import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVisibleGMResponse } from './src/gmTracker.js';

test('buildVisibleGMResponse', async (t) => {
  await t.test('Bloque al final', () => {
    const input = 'Texto visible para el jugador.\n[ESTADO_MISION]\nresultado: en_curso\n[/ESTADO_MISION]';
    const expected = 'Texto visible para el jugador.';
    assert.strictEqual(buildVisibleGMResponse(input), expected);
  });

  await t.test('Bloque en el medio', () => {
    const input = 'Inicio.\n[ESTADO_MISION]\nresultado: en_curso\n[/ESTADO_MISION]\nFin.';
    const expected = 'Inicio.\nFin.';
    assert.strictEqual(buildVisibleGMResponse(input), expected);
  });

  await t.test('Sin bloque de estado', () => {
    const input = 'Solo texto visible sin bloque.';
    const expected = 'Solo texto visible sin bloque.';
    assert.strictEqual(buildVisibleGMResponse(input), expected);
  });

  await t.test('Bloque sin etiqueta de cierre', () => {
    const input = 'Texto previo.\n[ESTADO_MISION]\nresultado: en_curso\nSin cierre';
    const expected = 'Texto previo.';
    assert.strictEqual(buildVisibleGMResponse(input), expected);
  });

  await t.test('Entrada nula', () => {
    assert.strictEqual(buildVisibleGMResponse(null), '');
  });

  await t.test('Entrada indefinida', () => {
    assert.strictEqual(buildVisibleGMResponse(undefined), '');
  });

  await t.test('Cadena vacía', () => {
    assert.strictEqual(buildVisibleGMResponse(''), '');
  });
});
